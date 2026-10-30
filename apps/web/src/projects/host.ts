/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { createEffect, createRoot, createSignal, on } from 'solid-js';

import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';
import { addGuestProject, inGuestMode } from '@/lib/guest';
import { keepBrowserStorage } from '@/lib/persistent-storage';
import {
	addProjectRecords,
	findProjectRecords,
	forgetProject as forgetProjectRecord,
	forgetProjectBundle,
	loadProjectBundle,
	listProjectRecords,
	listTrashedProjectRecords,
	moveProjectRecord,
	rememberProject,
	rememberProjectBundle,
	rememberProjectCover,
	restoreProjectRecord,
	trashProjectRecord,
	TRASH_RETENTION_MS,
	updateProjectRecord,
} from '@/lib/db';

import {
	browserCompileProject,
	browserCreateProject,
	browserDeleteProject,
	browserDuplicateProject,
	browserGetProject,
	browserMarkTrashed,
	browserReadConfig,
	browserRenameProject,
	browserWriteConfig,
	browserWriteProject,
} from './browser';
import { onFilesChangedElsewhere } from './browser-store';
import { browserProjectsRoot, claimSharedProjects, isProjectIn } from './owners';

import type { CompileResult, ProjectInfo, SourceEdit, WriteResult } from '@desktop/main-channels';
import type { ProjectRecord } from '@/lib/db';

export type { CompileResult, ProjectInfo, ProjectRecord, SourceEdit, WriteResult };

// On the desktop there is one projects root, so it is one localStorage value rather than a
// database row — read synchronously, so it is known from the first render.
// Unset for anyone who has never picked one, and for everyone upgrading from
// when the roots lived in the database: they get the default, or pick, the
// next time a project is created, and the projects the old root held come
// back with it (see `adoptProjectsRoot`).

const ROOT_STORAGE_KEY = 'planvideo:projects-root';
/** The key's name before the app was renamed; read once, then moved over. */
const LEGACY_ROOT_STORAGE_KEY = 'diffusion-studio:projects-root';

const storedRoot = (): string | null => {
	try {
		const legacy = window.localStorage.getItem(LEGACY_ROOT_STORAGE_KEY);
		if (legacy !== null) {
			if (window.localStorage.getItem(ROOT_STORAGE_KEY) === null) window.localStorage.setItem(ROOT_STORAGE_KEY, legacy);
			window.localStorage.removeItem(LEGACY_ROOT_STORAGE_KEY);
		}
		return window.localStorage.getItem(ROOT_STORAGE_KEY);
	} catch {
		return null;
	}
};

const [desktopRoot, setProjectsRoot] = createSignal<string | null>(window.desktop ? storedRoot() : null);

/**
 * The folder new projects are created in: null until one is picked. In the
 * browser, the signed-in person's own (see ./owners), null when no one is.
 */
export const projectsRoot = (): string | null => (window.desktop ? desktopRoot() : browserProjectsRoot());

// Bumped whenever the list of known projects changes — one created, opened,
// renamed, copied, or deleted — so a view listing them can refetch on it.
const [projectsRevision, setProjectsRevision] = createSignal(1);

/** Changes whenever the list `listProjects` answers with would; a source for `createResource`. */
export { projectsRevision };

// Someone else signing in on this browser has other projects.
if (!window.desktop) {
	createRoot(() => createEffect(on(browserProjectsRoot, () => setProjectsRevision((revision) => revision + 1), { defer: true })));
}

/** Tells the views the list changed, for a change made to the records directly (a cover landing). */
export function markProjectsChanged(): void {
	setProjectsRevision((revision) => revision + 1);
}

export const isDesktop = (): boolean => !!window.desktop;
export const isWindowsDesktop = (): boolean => window.desktop?.platform === "win32";
export const isMacOSDesktop = (): boolean => window.desktop?.platform === "darwin";

/** Puts `project` on the list (or marks it just opened) and tells the views. */
async function remember(project: ProjectInfo): Promise<void> {
	await rememberProject(project);
	setProjectsRevision((revision) => revision + 1);
}

/**
 * Makes `root` the projects root, and puts the projects it already holds on
 * the list — the ones that are not on it yet; the rest were opened when they
 * were opened. This is the one time the disk is searched for projects, and
 * what brings a user's projects back after an upgrade that forgot the root,
 * or a reinstall: pick the folder again, and there they are.
 */
async function adoptProjectsRoot(root: string): Promise<void> {
	try {
		window.localStorage.setItem(ROOT_STORAGE_KEY, root);
	} catch (error) {
		console.warn('[projects] could not store the projects root', error);
	}
	setProjectsRoot(root);

	let found: ProjectInfo[] = [];
	try {
		found = await mainBridge.call(MAIN_CHANNELS.PROJECTS_SCAN, { root });
	} catch (error) {
		console.warn(`[projects] could not look for projects in ${root}`, error);
	}
	if (found.length && (await addProjectRecords(found))) {
		setProjectsRevision((revision) => revision + 1);
	}
}

/** The projects root: null off the desktop and until one is picked. */
export async function getProjectsRoot(): Promise<string | null> {
	return projectsRoot();
}

/** Opens the native folder picker and adopts the chosen root. */
export async function pickProjectsRoot(): Promise<string | null> {
	const root = await mainBridge.call(MAIN_CHANNELS.PROJECTS_PICK_ROOT, undefined);
	if (!root) return null;

	await adoptProjectsRoot(root);
	return root;
}

/**
 * Opens the native folder picker for a folder to open as a single project.
 * Unlike `pickProjectsRoot` it changes nothing on its own — hand the path to
 * `openProjectFolder`, which is what makes the folder a project.
 */
export async function pickProjectFolder(): Promise<string | null> {
	if (!isDesktop()) return null;
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_PICK_FOLDER, undefined);
}

/**
 * The root to work against, defaulted to when there is none. Null off the
 * desktop, where there is no folder at all, and when the user is asked where
 * to put projects and declines to say.
 */
export async function ensureProjectsRoot(): Promise<string | null> {
	if (!isDesktop()) return browserProjectsRoot();

	const current = projectsRoot();
	if (current) return current;

	// Nothing picked yet: the default folder, so a first project costs a click
	// rather than a trip through the folder picker. The picker is still there
	// for anyone who wants to say — and for when the default will not do.
	const root = await mainBridge.call(MAIN_CHANNELS.PROJECTS_DEFAULT_ROOT, undefined);
	if (!root) return pickProjectsRoot();

	await adoptProjectsRoot(root);
	return root;
}

/**
 * The projects the app knows, most recently opened first, as their records
 * describe them — no folder is read. The dashboard shows this at launch, and
 * reading a folder under Desktop or Documents there is what would make macOS
 * ask for permission before the user has done anything; a project's folder
 * is looked at when the project is opened (see `checkProject`). So a record
 * whose folder is gone stays on the list until then: it may well come back
 * (a volume that is not mounted), and if not, opening it says so.
 */
export async function listProjects(): Promise<ProjectRecord[]> {
	await purgeExpiredTrash();
	return ownProjects(listProjectRecords);
}

/**
 * In the browser, only the projects of whoever is using it: the signed-in
 * person's, or the guest's in guest mode. Never those of someone who signed
 * in here before (see ./owners).
 */
async function ownProjects(read: () => Promise<ProjectRecord[]>): Promise<ProjectRecord[]> {
	if (isDesktop()) return read();
	await claimSharedProjects();
	const root = browserProjectsRoot();
	if (!root) return [];
	return (await read()).filter((record) => isProjectIn(root, record.dir));
}

/** Puts a project made in guest mode on the guest's list. */
function claimForGuest(project: ProjectInfo) {
	if (inGuestMode()) addGuestProject(project.id);
}

/**
 * What the folder of `project` holds now, its record brought up to date with
 * it: the project as it is, or null when the folder is gone or no longer a
 * project. For the moment before a project on the list is opened.
 */
export async function checkProject(project: ProjectInfo): Promise<ProjectInfo | null> {
	const current = await getProject(project.dir);
	if (current) await updateProjectRecord(current);
	return current;
}

/**
 * Re-reads the project in `dir` and brings its record up to date — for a
 * project whose folder changed while it was open, and for one that is
 * closing, so the dashboard shows what it was last edited as. Null when the
 * folder is gone.
 */
export async function refreshProject(dir: string): Promise<ProjectInfo | null> {
	const current = await getProject(dir);
	if (!current) return null;
	await updateProjectRecord(current);
	setProjectsRevision((revision) => revision + 1);
	return current;
}

/** Takes the project in `dir` off the list, leaving its folder alone, and tells the views. */
export async function forgetProject(dir: string): Promise<void> {
	await forgetProjectRecord(dir);
	setProjectsRevision((revision) => revision + 1);
}

/** Creates a project folder under the root, named after `displayName`, and puts it on the list. */
export async function createProject(displayName: string): Promise<ProjectInfo> {
	const root = projectsRoot();
	if (!root) throw new Error('No projects folder selected.');

	keepBrowserStorage();
	const project = isDesktop()
		? await mainBridge.call(MAIN_CHANNELS.PROJECTS_CREATE, { root, displayName })
		: await browserCreateProject(root, displayName);
	claimForGuest(project);
	await remember(project);
	return project;
}

/**
 * The project `ref` names: its id, or — for links made before ids existed,
 * and folders opened by name — its folder name. Only projects on the list
 * can be found; the records say which folders to look in, and the folders
 * say what they are now (one may have been renamed or replaced behind our
 * back, or be a folder that predates ids — in which case main gives it one
 * here, so the app can put an id in the URL).
 */
export async function resolveProject(ref: string): Promise<ProjectInfo | null> {
	if (!ref) return null;

	if (!isDesktop()) {
		await claimSharedProjects();
		const root = browserProjectsRoot();
		if (!root) return null;
		for (const record of await findProjectRecords(ref)) {
			if (!isProjectIn(root, record.dir)) continue;
			const project = await browserGetProject(record.dir);
			if (!project || (project.id !== ref && project.name !== ref)) continue;
			await rememberProject(project);
			return project;
		}
		return null;
	}

	for (const record of await findProjectRecords(ref)) {
		const project = await mainBridge.call(MAIN_CHANNELS.PROJECTS_RESOLVE, { dir: record.dir });
		if (!project || (project.id !== ref && project.name !== ref)) continue;
		// Just opened, and holding an id the record may not have had yet.
		await rememberProject(project);
		return project;
	}
	return null;
}

/**
 * Opens the folder `dir` as a project, making it one first when it is not:
 * the folder is created if missing and, when nothing in it can be an entry,
 * given an `index.tsx` holding an empty stage — and nothing else. Put on the
 * list, so it stays reachable by name or id across relaunches. How
 * `planvideo open <path>` lands anywhere on disk.
 */
export async function openProjectFolder(dir: string): Promise<ProjectInfo> {
	if (!isDesktop()) throw new Error('Opening a project folder isn\'t available in the browser.');

	const project = await mainBridge.call(MAIN_CHANNELS.PROJECTS_INIT, { dir });
	await remember(project);
	return project;
}

/** The project in the folder `dir`, or null when there is none. */
export async function getProject(dir: string): Promise<ProjectInfo | null> {
	if (!dir) return null;
	if (!isDesktop()) return browserGetProject(dir);
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_GET, { dir });
}

/**
 * Renames the project: `displayName` in the record, and the folder with it.
 * The folder moves, so the answer says where the project now lives — hold on
 * to it. Its id has not changed, and neither has its URL; the list follows
 * the folder.
 */
export async function renameProject(dir: string, displayName: string): Promise<ProjectInfo> {
	if (!dir) throw new Error('No project folder.');

	const project = isDesktop()
		? await mainBridge.call(MAIN_CHANNELS.PROJECTS_RENAME, { dir, displayName })
		: await browserRenameProject(dir, displayName);
	await moveProjectRecord(dir, project.dir);
	await remember(project);
	return project;
}

/** Copies the project in `dir` next to itself and returns the copy (a new id), on the list. */
export async function duplicateProject(dir: string): Promise<ProjectInfo> {
	if (!dir) throw new Error('No project folder.');

	if (!isDesktop()) {
		const source = (await listProjectRecords()).find((record) => record.dir === dir);
		const project = await browserDuplicateProject(dir);
		claimForGuest(project);
		await remember(project);
		if (source?.cover) {
			await rememberProjectCover(project.dir, source.cover);
			markProjectsChanged();
		}
		const bundle = source?.id ? await loadProjectBundle(source.id) : null;
		if (bundle) await rememberProjectBundle(project.id, bundle);
		return project;
	}

	const project = await mainBridge.call(MAIN_CHANNELS.PROJECTS_DUPLICATE, { dir });
	await remember(project);
	return project;
}

/**
 * Moves the project in `dir` to the trash and takes it off the projects list.
 * On the desktop that is the system trash, and the record goes with the
 * folder. In the browser the files stay, marked trashed, for 30 days.
 */
export async function deleteProject(dir: string): Promise<void> {
	if (!dir) throw new Error('No project folder.');

	if (isDesktop()) {
		await mainBridge.call(MAIN_CHANNELS.PROJECTS_DELETE, { dir });
		await forgetProject(dir);
		return;
	}

	const at = new Date().toISOString();
	await browserMarkTrashed(dir, at);
	await trashProjectRecord(dir, at);
	setProjectsRevision((revision) => revision + 1);
}

/** Projects in the in-app trash, most recently trashed first. Ones older than 30 days are deleted first. */
export async function listTrashedProjects(): Promise<ProjectRecord[]> {
	await purgeExpiredTrash();
	return ownProjects(listTrashedProjectRecords);
}

let purgingTrash: Promise<void> | null = null;

/** Permanently deletes browser projects that have been in the trash for 30 days. */
export function purgeExpiredTrash(): Promise<void> {
	if (isDesktop()) return Promise.resolve();
	if (!purgingTrash) {
		purgingTrash = purgeExpiredTrashNow().finally(() => {
			purgingTrash = null;
		});
	}
	return purgingTrash;
}

async function purgeExpiredTrashNow(): Promise<void> {
	try {
		const now = Date.now();
		const expired = (await ownProjects(listTrashedProjectRecords)).filter((record) => {
			const trashed = Date.parse(record.trashedAt ?? '');
			return Number.isFinite(trashed) && now - trashed >= TRASH_RETENTION_MS;
		});

		for (const project of expired) {
			try {
				await browserDeleteProject(project.dir);
				await forgetProjectRecord(project.dir);
				await forgetProjectBundle(project.id);
			} catch (error) {
				console.error(error);
			}
		}
	} catch (error) {
		console.error(error);
	}
}

/** Puts a trashed project back on the projects list. Its files were never removed. */
export async function restoreProject(dir: string): Promise<void> {
	if (!dir) throw new Error('No project folder.');
	if (!isDesktop()) await browserMarkTrashed(dir, null);
	await restoreProjectRecord(dir);
	setProjectsRevision((revision) => revision + 1);
}

/** Removes a trashed project for good: its files, its record, and its cached bundle. */
export async function eraseProject(project: ProjectInfo): Promise<void> {
	if (!project.dir) throw new Error('No project folder.');
	if (!isDesktop()) await browserDeleteProject(project.dir);
	await forgetProject(project.dir);
	await forgetProjectBundle(project.id);
}

/** Removes these projects for good, trashed or not: the ones made in a demo that's starting over (see lib/guest-demo.ts). */
export async function eraseProjectsById(ids: readonly string[]): Promise<void> {
	if (!ids.length || isDesktop()) return;
	for (const record of [...(await listProjectRecords()), ...(await listTrashedProjectRecords())]) {
		if (!ids.includes(record.id)) continue;
		await browserDeleteProject(record.dir);
		await forgetProjectRecord(record.dir);
		await forgetProjectBundle(record.id);
	}
	setProjectsRevision((revision) => revision + 1);
}

/**
 * What to put in a project's URL: its id, or its folder name while it has
 * none (a folder that predates ids gets one the next time it is opened).
 */
export const projectKey = (project: ProjectInfo): string => project.id || project.name;

export function compileProject(dir: string): Promise<CompileResult> {
	if (!isDesktop()) return browserCompileProject(dir);
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_COMPILE, { dir });
}

/**
 * Writes changed props back into the project's JSX. No compile follows: the
 * canvas is already showing these values, and main keeps the write from
 * reaching the watcher (see `noteContent` in the desktop's projects.ts).
 */
export function writeProject(dir: string, edits: SourceEdit[]): Promise<WriteResult> {
	if (!isDesktop()) return Promise.resolve(browserWriteProject(edits));
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_WRITE, { dir, edits });
}

/** The project's config (the `planvideo` field of its package.json), unparsed; null when absent. */
export function readProjectConfig(dir: string): Promise<unknown> {
	if (!isDesktop()) return browserReadConfig(dir);
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CONFIG_READ, { dir });
}

/** Replaces the project's config (null removes the field). Kept from the watcher like `writeProject`. */
export function writeProjectConfig(dir: string, config: unknown): Promise<void> {
	if (!isDesktop()) return browserWriteConfig(dir, config);
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CONFIG_WRITE, { dir, config });
}

/**
 * Watches a project folder and calls `onChange` with every file that changed
 * since the last call, coalescing a burst of them — an install, a checkout, a
 * folder dropped into the library — into one answer.
 *
 * The delay buys throughput and nothing else: main keeps the app's own writes
 * out of this stream by their content rather than by their timing (see
 * `noteContent` in the desktop's projects.ts) and writes whole files, so no
 * amount of waiting here is load-bearing.
 */
export function watchProject(dir: string, onChange: (paths: string[]) => void, debounceMs = 80): () => void {
	if (!isDesktop()) return watchBrowserProject(dir, onChange, debounceMs);

	let pending: ReturnType<typeof setTimeout> | undefined;
	let changed = new Set<string>();
	const stop = mainBridge.handle(MAIN_CHANNELS.PROJECTS_CHANGED, (event) => {
		if (event.dir !== dir) return;
		changed.add(event.path);
		clearTimeout(pending);
		pending = setTimeout(() => {
			const paths = [...changed];
			changed = new Set();
			onChange(paths);
		}, debounceMs);
	});

	mainBridge.call(MAIN_CHANNELS.PROJECTS_WATCH, { dir });

	return () => {
		clearTimeout(pending);
		stop();
		mainBridge.call(MAIN_CHANNELS.PROJECTS_UNWATCH, { dir }).catch(() => { });
	};
}

/**
 * A browser project changes outside this tab when another tab of this browser
 * writes to it, or the cloud sync brings down what another browser wrote.
 * Those are reported as the desktop reports edits made outside the app; this
 * tab's own writes never are. A hidden tab keeps what it hears until it is
 * shown again, so a project being edited in another tab is not reloaded here
 * at every save.
 */
function watchBrowserProject(dir: string, onChange: (paths: string[]) => void, debounceMs: number): () => void {
	const prefix = `${dir}/`;
	let pending: ReturnType<typeof setTimeout> | undefined;
	let changed = new Set<string>();

	const report = () => {
		clearTimeout(pending);
		pending = undefined;
		if (!changed.size || document.visibilityState === 'hidden') return;
		const paths = [...changed];
		changed = new Set();
		onChange(paths);
	};

	const stop = onFilesChangedElsewhere((paths) => {
		for (const path of paths) {
			if (path.startsWith(prefix)) changed.add(path.slice(prefix.length));
		}
		if (!changed.size) return;
		clearTimeout(pending);
		pending = setTimeout(report, debounceMs);
	});
	document.addEventListener('visibilitychange', report);

	return () => {
		clearTimeout(pending);
		stop();
		document.removeEventListener('visibilitychange', report);
	};
}
