/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { randomInt } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { IndentationText, Project, SyntaxKind } from "ts-morph";

import { ID_ATTR, INSPECT_TAG, formatSource, isCompositionTag, isLoopTag, isSerializedAssetRef, isTransformType, parseSource } from "@plan.video/jsx";

import { writeFileAtomic } from "./atomic";

import type { PropValue, SerializedAssetRef } from "@plan.video/jsx";
import type {
  ArrowFunction,
  FunctionExpression,
  JsxAttribute,
  JsxElement,
  JsxFragment,
  JsxOpeningElement,
  JsxSelfClosingElement,
  Node,
  SourceFile,
} from "ts-morph";

export type * from "./edit-types";
import type {
  EditValue,
  SourceContext,
  SourceEdit,
  SourceInsert,
  SourceIteration,
  SourceMove,
  SourceRemove,
  SourceUnroll,
  SourceVariable,
  WriteResult,
} from "./edit-types";

type JsxTag = JsxOpeningElement | JsxSelfClosingElement;

const SOURCE_FILE = /\.[jt]sx?$/;

const absolute = (dir: string, file: string): string => join(dir, ...file.split("/"));

/** Same order `./source` numbers. Walked, not `getDescendants`, which wraps every token. */
function tags(sourceFile: SourceFile): JsxTag[] {
  return tagsIn(sourceFile);
}

function tagsIn(node: Node): JsxTag[] {
  const found: JsxTag[] = [];
  const visit = (candidate: Node): void => {
    if (candidate.isKind(SyntaxKind.JsxSelfClosingElement)) found.push(candidate);
    else if (candidate.isKind(SyntaxKind.JsxElement)) found.push(candidate.getOpeningElement());
  };
  visit(node);
  node.forEachDescendant(visit);
  return found;
}

const tagName = (tag: JsxTag): string => tag.getTagNameNode().getText();

const attributeOf = (tag: JsxTag, name: string): JsxAttribute | undefined =>
  tag.getAttribute(name)?.asKind(SyntaxKind.JsxAttribute);

const idOf = (tag: JsxTag): string | undefined =>
  attributeOf(tag, ID_ATTR)?.getInitializer()?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();

/** Ids can be copied, so an ambiguous id resolves to nothing and the write is reported instead. */
function findTag(sourceFile: SourceFile, locator: number | string): JsxTag | undefined {
  const all = tags(sourceFile);
  if (typeof locator === "number") return all[locator];

  const matches = all.filter((tag) => idOf(tag) === locator);
  return matches.length === 1 ? matches[0] : undefined;
}

const idsIn = (sourceFile: SourceFile): Set<string> =>
  new Set(tags(sourceFile).flatMap((tag) => idOf(tag) ?? []));

const ID_LENGTH = 6;
const ID_SPACE = 36 ** ID_LENGTH;

function idAllocator(taken: Set<string>): () => string {
  return () => {
    while (true) {
      const id = randomInt(ID_SPACE).toString(36).padStart(ID_LENGTH, "0");
      if (taken.has(id)) continue;
      taken.add(id);
      return id;
    }
  };
}

const round = (value: number): number => Math.round(value * 100) / 100;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function literalText(value: PropValue | SerializedAssetRef): string {
  if (isSerializedAssetRef(value)) return declarationText(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(round(value));
  if (typeof value === "boolean" || value === null) return String(value);
  if (Array.isArray(value)) return `[${value.map(literalText).join(", ")}]`;

  const entries = Object.entries(value).map(
    ([key, nested]) => `${IDENTIFIER.test(key) ? key : JSON.stringify(key)}: ${literalText(nested)}`,
  );
  return entries.length ? `{ ${entries.join(", ")} }` : "{}";
}

/** An attribute string is raw text, not JavaScript: a backslash escapes nothing. */
const UNQUOTABLE = /["&\p{Cc}\u2028\u2029]/u;

const initializerText = (value: PropValue): string =>
  typeof value === "string" && !UNQUOTABLE.test(value)
    ? `"${value}"`
    : `{${literalText(value)}}`;

function declarationText(ref: SerializedAssetRef): string {
  const { type, ...options } = ref.$asset;
  if (isTransformType(type)) return `transform.${type}(${literalText((options as { input: EditValue }).input)})`;
  return `generate.${type}(${literalText(options as Record<string, PropValue>)})`;
}

function declarationImports(ref: SerializedAssetRef, names = new Set<string>()): Set<string> {
  const { type, ...options } = ref.$asset;
  names.add(isTransformType(type) ? "transform" : "generate");
  for (const value of Object.values(options)) {
    for (const input of Array.isArray(value) ? value : [value]) {
      if (isSerializedAssetRef(input)) declarationImports(input, names);
    }
  }
  return names;
}

/** Boolean false is written as no attribute. The caller imports the declaration's namespaces. */
function setProp(tag: JsxTag, name: string, value: EditValue): void {
  const attribute = attributeOf(tag, name);

  if (isSerializedAssetRef(value)) {
    const initializer = `{${declarationText(value)}}`;
    if (attribute) attribute.setInitializer(initializer);
    else tag.addAttribute({ name, initializer });
    return;
  }

  if (value === true) {
    if (attribute) attribute.removeInitializer();
    else tag.addAttribute({ name });
    return;
  }

  if (value === false) {
    attribute?.remove();
    return;
  }

  if (attribute) attribute.setInitializer(initializerText(value));
  else tag.addAttribute({ name, initializer: initializerText(value) });
}

const DECLARATION_MODULE = "@plan.video/jsx";

function ensureDeclarationImports(sourceFile: SourceFile, ref: SerializedAssetRef): void {
  for (const name of declarationImports(ref)) ensureNamedImport(sourceFile, name);
}

function ensureNamedImport(sourceFile: SourceFile, name: string): void {
  const declarations = sourceFile.getImportDeclarations();
  const importable = declarations.find(
    (declaration) =>
      declaration.getModuleSpecifierValue() === DECLARATION_MODULE &&
      !declaration.isTypeOnly() &&
      !declaration.getNamespaceImport(),
  );

  if (importable) {
    const named = importable.getNamedImports();
    if (named.some((specifier) => specifier.getName() === name && !specifier.getAliasNode())) return;
    importable.addNamedImport(name);
    return;
  }

  const statement = `import { ${name} } from "${DECLARATION_MODULE}";`;
  const last = declarations.at(-1);
  if (last) sourceFile.insertText(last.getEnd(), `\n${statement}`);
  else {
    const first = sourceFile.getStatements()[0];
    sourceFile.insertText(first ? first.getStart() : 0, `${statement}\n\n`);
  }
}

/** JSX collapses whitespace around line breaks and reads `{`, `}`, `<`, `>`, `&` as syntax. */
function jsxText(text: string): string {
  return /^[^\s{}<>&][^\n{}<>&]*[^\s{}<>&]$|^[^\s{}<>&]$/.test(text) ? text : `{${JSON.stringify(text)}}`;
}

function setText(sourceFile: SourceFile, tag: JsxTag, text: string): void {
  const element = elementOf(tag);
  const content = text ? jsxText(text) : "";

  if (element.isKind(SyntaxKind.JsxSelfClosingElement)) {
    const opening = element.getText().replace(/\s*\/>$/, ">");
    sourceFile.replaceText([element.getStart(), element.getEnd()], `${opening}${content}</${tagName(tag)}>`);
    return;
  }

  sourceFile.replaceText([element.getOpeningElement().getEnd(), element.getClosingElement().getStart()], content);
}

/** ts-morph does not learn a file's indentation, so match its `indentationText` to the file first. */
function matchIndentation(sourceFile: SourceFile): void {
  const lead = /^([ \t]+)\S/m.exec(sourceFile.getFullText())?.[1] ?? "";
  const indentationText = lead.startsWith("\t")
    ? IndentationText.Tab
    : lead.length >= 8
      ? IndentationText.EightSpaces
      : lead.length >= 4
        ? IndentationText.FourSpaces
        : IndentationText.TwoSpaces;
  sourceFile.getProject().manipulationSettings.set({ indentationText });
}

const elementOf = (tag: JsxTag): JsxElement | JsxSelfClosingElement =>
  tag.isKind(SyntaxKind.JsxOpeningElement) ? tag.getParentIfKindOrThrow(SyntaxKind.JsxElement) : tag;

type JsxBody = JsxElement | JsxSelfClosingElement | JsxFragment;
type LoopCallback = ArrowFunction | FunctionExpression;

const isLoopElement = (node: Node): node is JsxElement =>
  node.isKind(SyntaxKind.JsxElement) && isLoopTag(tagName(node.getOpeningElement()));

/** A write to an element in a loop body would reach every iteration, so those are refused (see `SourceUnroll`). */
const loopOf = (element: Node): JsxElement | undefined => element.getAncestors().find(isLoopElement);

const inLoop = (tag: JsxTag): boolean => loopOf(elementOf(tag)) !== undefined;

const isBlankText = (node: Node): boolean =>
  node.isKind(SyntaxKind.JsxText) && node.containsOnlyTriviaWhiteSpaces();

function loopBody(loop: JsxElement): { callback: LoopCallback; body: JsxBody } | undefined {
  const children = loop.getJsxChildren().filter((child) => !isBlankText(child));
  if (children.length !== 1) return undefined;

  const expression = children[0]!.asKind(SyntaxKind.JsxExpression)?.getExpression();
  const callback = expression?.asKind(SyntaxKind.ArrowFunction) ?? expression?.asKind(SyntaxKind.FunctionExpression);
  if (!callback) return undefined;

  let returned: Node | undefined = callback.getBody();
  if (returned.isKind(SyntaxKind.Block)) {
    const statements = returned.getStatements();
    if (statements.length !== 1) return undefined;
    returned = statements[0]!.asKind(SyntaxKind.ReturnStatement)?.getExpression();
  }
  while (returned?.isKind(SyntaxKind.ParenthesizedExpression)) returned = returned.getExpression();

  const body =
    returned?.asKind(SyntaxKind.JsxElement) ??
    returned?.asKind(SyntaxKind.JsxSelfClosingElement) ??
    returned?.asKind(SyntaxKind.JsxFragment);
  return body === undefined ? undefined : { callback, body };
}

/** Over-approximated: every identifier in the parameter list. */
function boundNames(callback: LoopCallback): Set<string> {
  const names = new Set<string>();
  for (const parameter of callback.getParameters()) {
    const name = parameter.getNameNode();
    if (name.isKind(SyntaxKind.Identifier)) names.add(name.getText());
    for (const identifier of name.getDescendantsOfKind(SyntaxKind.Identifier)) names.add(identifier.getText());
  }
  return names;
}

function mentions(attribute: JsxAttribute, names: Set<string>): boolean {
  const initializer = attribute.getInitializer();
  if (!initializer) return false;
  if (initializer.isKind(SyntaxKind.Identifier) && names.has(initializer.getText())) return true;
  return initializer.getDescendantsOfKind(SyntaxKind.Identifier).some((identifier) => names.has(identifier.getText()));
}

const isTextTag = (tag: JsxTag): boolean => {
  const name = tagName(tag);
  return name === "text" || name === "Text";
};

/** ts-morph cannot do this without re-printing the parent's body, so these are text edits. */
function insertChild(sourceFile: SourceFile, parent: JsxTag, child: string, before?: JsxTag): void {
  matchIndentation(sourceFile);
  const element = elementOf(parent);
  const indent = element.getIndentationText();
  const childIndent = element.getChildIndentationText();

  if (element.isKind(SyntaxKind.JsxSelfClosingElement)) {
    const opening = element.getText().replace(/\s*\/>$/, ">");
    sourceFile.replaceText(
      [element.getStart(), element.getEnd()],
      `${opening}\n${childIndent}${child}\n${indent}</${tagName(parent)}>`,
    );
    return;
  }

  if (before) {
    const anchor = elementOf(before);
    if (anchor.isFirstNodeOnLine()) sourceFile.insertText(anchor.getStartLinePos(), `${anchor.getIndentationText()}${child}\n`);
    else sourceFile.insertText(anchor.getStart(), `${child} `);
    return;
  }

  const closing = element.getClosingElement();
  if (closing.isFirstNodeOnLine()) sourceFile.insertText(closing.getStartLinePos(), `${childIndent}${child}\n`);
  else sourceFile.insertText(closing.getStart(), `\n${childIndent}${child}\n${indent}`);
}

function cutElement(sourceFile: SourceFile, element: JsxElement | JsxSelfClosingElement): void {
  let start = element.getStart();
  let end = element.getEnd();

  if (element.isFirstNodeOnLine()) {
    const rest = sourceFile.getFullText().slice(end);
    const breakAt = rest.indexOf("\n");
    const trailing = breakAt === -1 ? rest : rest.slice(0, breakAt + 1);

    if (!trailing.trim()) {
      start = element.getStartLinePos();
      end += trailing.length;
    }
  }

  sourceFile.removeText(start, end);
}

function reindent(text: string, from: string, to: string): string {
  if (from === to) return text;

  return text
    .split("\n")
    .map((line, index) => (index === 0 || !line.startsWith(from) ? line : `${to}${line.slice(from.length)}`))
    .join("\n");
}

function isLiteral(node: Node): boolean {
  if (isDeclarationCall(node)) return true;

  if (
    node.isKind(SyntaxKind.StringLiteral) ||
    node.isKind(SyntaxKind.NumericLiteral) ||
    node.isKind(SyntaxKind.TrueKeyword) ||
    node.isKind(SyntaxKind.FalseKeyword) ||
    node.isKind(SyntaxKind.NullKeyword)
  ) {
    return true;
  }

  if (node.isKind(SyntaxKind.PrefixUnaryExpression)) {
    const operator = node.getOperatorToken();
    const signed = operator === SyntaxKind.MinusToken || operator === SyntaxKind.PlusToken;
    return signed && isLiteral(node.getOperand());
  }

  if (node.isKind(SyntaxKind.ArrayLiteralExpression)) {
    return node.getElements().every(isLiteral);
  }

  if (node.isKind(SyntaxKind.ObjectLiteralExpression)) {
    return node.getProperties().every((property) => {
      const assignment = property.asKind(SyntaxKind.PropertyAssignment);
      if (!assignment || assignment.getNameNode().isKind(SyntaxKind.ComputedPropertyName)) return false;

      const initializer = assignment.getInitializer();
      return initializer !== undefined && isLiteral(initializer);
    });
  }

  return false;
}

const DECLARATION_NAMESPACES = new Set(["generate", "transform"]);

function isDeclarationCall(node: Node): boolean {
  const call = node.asKind(SyntaxKind.CallExpression);
  const callee = call?.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
  if (!call || !callee || !callee.getExpression().isKind(SyntaxKind.Identifier)) return false;
  if (!DECLARATION_NAMESPACES.has(callee.getExpression().getText())) return false;

  const args = call.getArguments();
  return args.length === 1 && isLiteral(args[0]!);
}

async function sourceFiles(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(prefix ? join(dir, ...prefix.split("/")) : dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await sourceFiles(dir, path)));
    else if (SOURCE_FILE.test(entry.name)) files.push(path);
  }
  return files;
}

interface OpenFile {
  sourceFile: SourceFile;
  text: string;
}

interface FileWrite {
  skipped: string[];
  ids: Record<string, string>;
  unrolled: string[];
}

export const editLabel = (edit: SourceEdit): string =>
  edit.kind === "variable" ? formatSource(edit.file, edit.name) : edit.source;

function locate(
  source: string,
  ids: Record<string, string>,
): { file: string; locator: number | string } | undefined {
  return parseSource(ids[source] ?? source);
}

/** One instance per operation, so a write never edits a tree parsed before the project changed. */
class SourceWriter {
  // Types are never asked about, so the standard library is not loaded: parsing it costs more than the rest.
  private readonly project = new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
  });
  private readonly files = new Map<string, OpenFile>();
  private readonly context: SourceContext;

  public constructor(context: SourceContext) {
    this.context = context;
  }

  private async load(path: string): Promise<void> {
    if (this.files.has(path)) return;

    let text: string;
    try {
      text = await readFile(absolute(this.context.dir, path), "utf8");
    } catch {
      return;
    }

    // The extension decides the dialect: in `.ts`, `<T>value` is a type assertion.
    const sourceFile = this.project.createSourceFile(`/${path}`, text, { overwrite: true });
    this.files.set(path, { sourceFile, text });
  }

  /**
   * Re-printing a file the parser guessed at would hand back source no one wrote. One pass,
   * because ts-morph rebuilds its program whenever a file arrives or changes.
   */
  private dropUnparsed(paths: Iterable<string> = this.files.keys()): void {
    const program = this.project.getProgram();
    for (const path of [...paths]) {
      const open = this.files.get(path);
      if (!open) continue;
      if (program.getSyntacticDiagnostics(open.sourceFile).length) this.discard(path);
    }
  }

  private discard(path: string): void {
    const open = this.files.get(path);
    if (!open) return;
    this.files.delete(path);
    this.project.removeSourceFile(open.sourceFile);
  }

  private async save(): Promise<void> {
    for (const [path, open] of this.files) {
      const text = open.sourceFile.getFullText();
      if (text === open.text) continue;
      open.text = text;

      // Claimed with the bytes before the write lands, so the watcher always knows the change is ours.
      this.context.onWrite?.(path, text);
      await writeFileAtomic(absolute(this.context.dir, path), text);
    }
  }

  public async stampProject(paths: string[]): Promise<void> {
    for (const path of paths) await this.load(path);
    this.dropUnparsed();

    for (const path of [...this.files.keys()]) this.stampFile(path);

    this.dropUnparsed();
    await this.save();
  }

  private stampFile(path: string): void {
    const sourceFile = this.files.get(path)!.sourceFile;
    const nextId = idAllocator(idsIn(sourceFile));

    // All ids in one manipulation, so the file is reparsed once rather than per element.
    const changes = tags(sourceFile).flatMap((tag) => {
      if (!isCompositionTag(tagName(tag)) || idOf(tag)) return [];

      const at = (tag.getAttributes().at(-1) ?? tag.getTagNameNode()).getEnd();
      return [{ span: { start: at, length: 0 }, newText: ` ${ID_ATTR}="${nextId()}"` }];
    });

    if (!changes.length) return;

    try {
      sourceFile.applyTextChanges(changes);
    } catch {
      this.discard(path);
    }
  }

  public async applyEdits(edits: SourceEdit[]): Promise<WriteResult> {
    const skipped: string[] = [];
    const ids: Record<string, string> = {};
    const unrolled: string[] = [];

    const fileOf = new Map<string, string>();
    const byFile = new Map<string, SourceEdit[]>();
    for (const edit of edits) {
      let file: string | undefined;
      if (edit.kind === "variable") {
        file = edit.file;
      } else {
        const address = edit.kind === "insert" ? edit.parent : edit.source;
        file = parseSource(address)?.file ?? fileOf.get(address);
      }
      if (!file) {
        skipped.push(editLabel(edit));
        continue;
      }
      if (edit.kind === "insert") fileOf.set(edit.source, file);
      if (edit.kind === "unroll") {
        for (const iteration of edit.iterations) {
          for (const { pending } of Object.values(iteration)) {
            if (pending) fileOf.set(pending, file);
          }
        }
      }
      byFile.set(file, [...(byFile.get(file) ?? []), edit]);
    }

    for (const file of byFile.keys()) await this.load(file);
    this.dropUnparsed(byFile.keys());

    for (const [file, entries] of byFile) {
      const sourceFile = this.files.get(file)?.sourceFile;
      const written = sourceFile ? this.editFile(file, sourceFile, entries) : undefined;

      // All or nothing per file: a tree ts-morph will not vouch for is dropped, never half written.
      if (!written) {
        this.discard(file);
        skipped.push(...entries.map(editLabel));
        continue;
      }

      skipped.push(...written.skipped);
      Object.assign(ids, written.ids);
      unrolled.push(...written.unrolled);
    }

    await this.save();
    return {
      skipped,
      ...(Object.keys(ids).length ? { ids } : {}),
      ...(unrolled.length ? { unrolled } : {}),
    };
  }

  private editFile(file: string, sourceFile: SourceFile, entries: SourceEdit[]): FileWrite | undefined {
    const nextId = idAllocator(idsIn(sourceFile));
    const skipped: string[] = [];
    const ids: Record<string, string> = {};
    const unrolled: string[] = [];

    try {
      for (const edit of entries) {
        if (edit.kind === "variable") {
          if (!this.setVariable(sourceFile, edit)) skipped.push(`${editLabel(edit)} (variable)`);
          continue;
        }

        if (edit.kind === "insert") {
          if (!this.insertElement(file, sourceFile, edit, ids, nextId)) skipped.push(edit.source);
          continue;
        }

        if (edit.kind === "move") {
          if (!this.moveElement(file, sourceFile, edit, ids, nextId)) skipped.push(edit.source);
          continue;
        }

        if (edit.kind === "remove") {
          if (!this.removeElement(file, sourceFile, edit, ids)) skipped.push(edit.source);
          continue;
        }

        if (edit.kind === "unroll") {
          if (this.unrollLoop(file, sourceFile, edit, ids, nextId)) unrolled.push(edit.source);
          else skipped.push(`${edit.source} (loop)`);
          continue;
        }

        const locator = locate(edit.source, ids)?.locator;
        if (locator === undefined) {
          skipped.push(edit.source);
          continue;
        }

        let wrote = false;

        for (const [name, value] of Object.entries(edit.props)) {
          // Re-resolved per prop: editing one attribute forgets its siblings.
          const tag = findTag(sourceFile, locator);
          if (!tag) {
            skipped.push(edit.source);
            break;
          }

          // A loop's elements must be unrolled before one can take its own value.
          if (inLoop(tag)) {
            skipped.push(`${edit.source} (loop)`);
            break;
          }

          // The user wins over an expression too: a prop left as it was would move back on the next render.
          setProp(tag, name, value);
          if (isSerializedAssetRef(value)) ensureDeclarationImports(sourceFile, value);
          wrote = true;
        }

        if (edit.text !== undefined) {
          const tag = findTag(sourceFile, locator);
          if (!tag) skipped.push(edit.source);
          else if (inLoop(tag)) skipped.push(`${edit.source} (loop)`);
          else if (!isTextTag(tag)) skipped.push(`${edit.source} (text)`);
          else {
            setText(sourceFile, tag, edit.text);
            wrote = true;
          }
        }

        const tag = wrote ? findTag(sourceFile, locator) : undefined;
        if (!tag || idOf(tag)) continue;

        const id = nextId();
        tag.addAttribute({ name: ID_ATTR, initializer: `"${id}"` });
        ids[edit.source] = formatSource(file, id);
      }
    } catch {
      return undefined;
    }

    this.dropUnparsed([file]);
    return this.files.has(file) ? { skipped, ids, unrolled } : undefined;
  }

  private setVariable(sourceFile: SourceFile, edit: SourceVariable): boolean {
    for (const statement of sourceFile.getVariableStatements()) {
      const declaration = statement.getDeclarations().find((candidate) => candidate.getName() === edit.name);
      if (!declaration) continue;
      // Same leniency as the compile step: the tag at the start of any leading comment line.
      const annotated = statement.getLeadingCommentRanges().some((range) =>
        new RegExp(`(?:^|\\n)[\\s/*]*@${INSPECT_TAG}\\b`).test(range.getText()),
      );
      if (!annotated) continue;

      const initializer = declaration.getInitializer();
      if (!initializer || !isLiteral(initializer)) return false;
      declaration.setInitializer(literalText(edit.value));
      return true;
    }
    return false;
  }

  private insertElement(
    file: string,
    sourceFile: SourceFile,
    edit: SourceInsert,
    ids: Record<string, string>,
    nextId: () => string,
  ): boolean {
    if (!isCompositionTag(edit.tag)) return false;

    const parentLocator = locate(edit.parent, ids)?.locator;
    const parent = parentLocator === undefined ? undefined : findTag(sourceFile, parentLocator);
    if (!parent || inLoop(parent)) return false;

    let before: JsxTag | undefined;
    if (edit.before !== undefined) {
      const anchorLocator = locate(edit.before, ids)?.locator;
      before = anchorLocator === undefined ? undefined : findTag(sourceFile, anchorLocator);
      if (!before || elementOf(before).getParent() !== elementOf(parent)) return false;
    }

    // Editing one attribute forgets its siblings, so each is re-found by name.
    const id = nextId();
    const opening = `<${edit.tag} ${ID_ATTR}="${id}"`;
    const child = edit.text === undefined ? `${opening} />` : `${opening}>${jsxText(edit.text)}</${edit.tag}>`;
    insertChild(sourceFile, parent, child, before);
    for (const [name, value] of Object.entries(edit.props)) {
      setProp(findTag(sourceFile, id)!, name, value);
      if (isSerializedAssetRef(value)) ensureDeclarationImports(sourceFile, value);
    }
    ids[edit.source] = formatSource(file, id);
    return true;
  }

  /** Everything is addressed by id first, since cutting the text renumbers positions. */
  private moveElement(
    file: string,
    sourceFile: SourceFile,
    edit: SourceMove,
    ids: Record<string, string>,
    nextId: () => string,
  ): boolean {
    const named = (source: string): string | undefined => {
      const address = locate(source, ids);
      // Ids are per file, so one from elsewhere could name an unrelated element here.
      const locator = address?.file === file ? address.locator : undefined;
      const tag = locator === undefined ? undefined : findTag(sourceFile, locator);
      if (!tag || inLoop(tag)) return undefined;
      const id = idOf(tag);
      if (id) return id;

      const minted = nextId();
      tag.addAttribute({ name: ID_ATTR, initializer: `"${minted}"` });
      ids[source] = formatSource(file, minted);
      return minted;
    };

    // Each stamp re-parses, so tags are re-found from ids rather than held across edits.
    const id = named(edit.source);
    const parentId = named(edit.parent);
    if (!id || !parentId || id === parentId) return false;
    const beforeId = edit.before === undefined ? undefined : named(edit.before);
    if (edit.before !== undefined && !beforeId) return false;

    const element = elementOf(findTag(sourceFile, id)!);
    const parentElement = elementOf(findTag(sourceFile, parentId)!);
    if (parentElement.getAncestors().includes(element)) return false;

    if (beforeId !== undefined) {
      const anchor = elementOf(findTag(sourceFile, beforeId)!);
      if (anchor.getParent() !== parentElement) return false;
    }

    // Before any indentation is measured (see `matchIndentation`).
    matchIndentation(sourceFile);
    const text = element.getText();
    const indent = element.getIndentationText();
    cutElement(sourceFile, element);

    const parent = findTag(sourceFile, parentId);
    const before = beforeId === undefined ? undefined : findTag(sourceFile, beforeId);
    if (!parent || (beforeId !== undefined && !before)) throw new Error("the element's new parent is gone");

    insertChild(sourceFile, parent, reindent(text, indent, elementOf(parent).getChildIndentationText()), before);
    return true;
  }

  /** An element already removed with its parent in this write is not a failure. */
  private removeElement(
    file: string,
    sourceFile: SourceFile,
    edit: SourceRemove,
    ids: Record<string, string>,
  ): boolean {
    const address = locate(edit.source, ids);
    const locator = address?.file === file ? address.locator : undefined;
    const tag = locator === undefined ? undefined : findTag(sourceFile, locator);
    if (!tag || inLoop(tag)) return false;

    matchIndentation(sourceFile);
    cutElement(sourceFile, elementOf(tag));
    return true;
  }

  /**
   * Writes the loop's iterations out: copies of the body with each iteration's props as literals
   * and the spreads removed. False when the source can't spell it out (nested loop, computed
   * callback, non-composition elements, or props the canvas did not report).
   */
  private unrollLoop(
    file: string,
    sourceFile: SourceFile,
    edit: SourceUnroll,
    ids: Record<string, string>,
    nextId: () => string,
  ): boolean {
    const locator = locate(edit.source, ids)?.locator;
    const tag = locator === undefined ? undefined : findTag(sourceFile, locator);
    const loop = tag === undefined ? undefined : loopOf(elementOf(tag));
    if (!tag || !loop || loopOf(loop)) return false;

    const shape = loopBody(loop);
    if (!shape) return false;
    const bound = boundNames(shape.callback);

    const iterations: Map<string, SourceIteration[string]>[] = [];
    for (const iteration of edit.iterations) {
      const byId = new Map<string, SourceIteration[string]>();
      for (const [source, record] of Object.entries(iteration)) {
        const address = parseSource(source);
        if (address?.file !== file || typeof address.locator !== "string") return false;
        byId.set(address.locator, record);
      }
      iterations.push(byId);
    }
    if (!iterations.length) return false;

    const roots: (JsxElement | JsxSelfClosingElement)[] = [];
    for (const child of shape.body.isKind(SyntaxKind.JsxFragment) ? shape.body.getJsxChildren() : [shape.body]) {
      if (isBlankText(child)) continue;
      if (child.isKind(SyntaxKind.JsxElement) || child.isKind(SyntaxKind.JsxSelfClosingElement)) roots.push(child);
      else return false;
    }
    if (!roots.length) return false;

    const bodyTags = roots.flatMap(tagsIn);
    const bodyIds: string[] = [];
    for (const bodyTag of bodyTags) {
      const id = idOf(bodyTag);
      if (!isCompositionTag(tagName(bodyTag)) || !id || bodyIds.includes(id)) return false;
      if (!iterations.every((iteration) => iteration.has(id))) return false;
      bodyIds.push(id);

      for (const attribute of bodyTag.getAttributes()) {
        if (!attribute.isKind(SyntaxKind.JsxAttribute)) continue;
        const name = attribute.getNameNode().getText();
        if (name === ID_ATTR) continue;
        if (iterations.every((iteration) => name in iteration.get(id)!.props)) continue;
        if (mentions(attribute, bound)) return false;
      }

      const element = elementOf(bodyTag);
      if (element.isKind(SyntaxKind.JsxSelfClosingElement)) continue;
      const text = isTextTag(bodyTag);
      for (const child of element.getJsxChildren()) {
        if (isBlankText(child)) continue;
        if (child.isKind(SyntaxKind.JsxText) || child.isKind(SyntaxKind.JsxExpression)) {
          if (!text) return false;
        } else if (child.isKind(SyntaxKind.JsxElement) || child.isKind(SyntaxKind.JsxSelfClosingElement)) {
          if (text) return false;
        } else {
          return false;
        }
      }
    }

    // Before any indentation is measured (see `matchIndentation`).
    matchIndentation(sourceFile);
    const indent = loop.getIndentationText();

    const minted: Map<string, string>[] = iterations.map(() => new Map());
    const copies = iterations.map((iteration, index) =>
      roots
        .map((root) => {
          let text = root.getText();
          if (index > 0) {
            const swaps = tagsIn(root)
              .map((bodyTag) => {
                const id = idOf(bodyTag)!;
                const initializer = attributeOf(bodyTag, ID_ATTR)!.getInitializer()!;
                const fresh = nextId();
                minted[index]!.set(id, fresh);
                const pending = iteration.get(id)!.pending;
                if (pending) ids[pending] = formatSource(file, fresh);
                return { start: initializer.getStart() - root.getStart(), end: initializer.getEnd() - root.getStart(), fresh };
              })
              .sort((a, b) => b.start - a.start);
            for (const swap of swaps) text = `${text.slice(0, swap.start)}"${swap.fresh}"${text.slice(swap.end)}`;
          }
          return reindent(text, root.getIndentationText(), indent);
        })
        .join(`\n${indent}`),
    );
    sourceFile.replaceText([loop.getStart(), loop.getEnd()], copies.join(`\n${indent}`));

    // Editing one attribute forgets its siblings, so each is re-found after each write.
    for (const [index, iteration] of iterations.entries()) {
      for (const bodyId of bodyIds) {
        const id = minted[index]!.get(bodyId) ?? bodyId;
        const record = iteration.get(bodyId)!;
        const found = (): JsxTag => {
          const copy = findTag(sourceFile, id);
          if (!copy) throw new Error(`the copy of ${bodyId} for iteration ${index} is gone`);
          return copy;
        };

        for (let spread = found().getAttributes().find((a) => a.isKind(SyntaxKind.JsxSpreadAttribute)); spread; ) {
          spread.remove();
          spread = found().getAttributes().find((a) => a.isKind(SyntaxKind.JsxSpreadAttribute));
        }
        for (const [name, value] of Object.entries(record.props)) {
          setProp(found(), name, value);
          if (isSerializedAssetRef(value)) ensureDeclarationImports(sourceFile, value);
        }

        const element = elementOf(found());
        if (element.isKind(SyntaxKind.JsxElement) && isTextTag(element.getOpeningElement())) {
          const content = record.text ? jsxText(record.text) : "";
          sourceFile.replaceText([element.getOpeningElement().getEnd(), element.getClosingElement().getStart()], content);
        }
      }
    }

    return true;
  }
}

export async function stampProject(context: SourceContext): Promise<void> {
  await new SourceWriter(context).stampProject(await sourceFiles(context.dir));
}

export function applyEdits(context: SourceContext, edits: SourceEdit[]): Promise<WriteResult> {
  return new SourceWriter(context).applyEdits(edits);
}
