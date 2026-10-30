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

// One localStorage value rather than a database row, so it is known from the first render.

const ROOT_STORAGE_KEY = 'planvideo:projects-root';
/** Read once, then moved over. */
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

export const projectsRoot = (): string | null => (window.desktop ? desktopRoot() : browserProjectsRoot());

const [projectsRevision, setProjectsRevision] = createSignal(1);

export { projectsRevision };

if (!window.desktop) {
	createRoot(() => createEffect(on(browserProjectsRoot, () => setProjectsRevision((revision) => revision + 1), { defer: true })));
}

export function markProjectsChanged(): void {
	setProjectsRevision((revision) => revision + 1);
}

export const isDesktop = (): boolean => !!window.desktop;
export const isWindowsDesktop = (): boolean => window.desktop?.platform === "win32";
export const isMacOSDesktop = (): boolean => window.desktop?.platform === "darwin";

async function remember(project: ProjectInfo): Promise<void> {
	await rememberProject(project);
	setProjectsRevision((revision) => revision + 1);
}

// The one time the disk is searched for projects: picking the folder again brings them back after a reinstall.
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

export async function getProjectsRoot(): Promise<string | null> {
	return projectsRoot();
}

export async function pickProjectsRoot(): Promise<string | null> {
	const root = await mainBridge.call(MAIN_CHANNELS.PROJECTS_PICK_ROOT, undefined);
	if (!root) return null;

	await adoptProjectsRoot(root);
	return root;
}

// Changes nothing on its own; `openProjectFolder` is what makes the folder a project.
export async function pickProjectFolder(): Promise<string | null> {
	if (!isDesktop()) return null;
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_PICK_FOLDER, undefined);
}

export async function ensureProjectsRoot(): Promise<string | null> {
	if (!isDesktop()) return browserProjectsRoot();

	const current = projectsRoot();
	if (current) return current;

	// Default folder, so a first project costs a click rather than a trip through the picker.
	const root = await mainBridge.call(MAIN_CHANNELS.PROJECTS_DEFAULT_ROOT, undefined);
	if (!root) return pickProjectsRoot();

	await adoptProjectsRoot(root);
	return root;
}

// Never reads a folder: reading one under Desktop or Documents at launch makes macOS ask for permission.
// A record whose folder is gone stays listed until opened (it may be an unmounted volume).
export async function listProjects(): Promise<ProjectRecord[]> {
	await purgeExpiredTrash();
	return ownProjects(listProjectRecords);
}

// Never list projects of someone who signed in on this browser before.
async function ownProjects(read: () => Promise<ProjectRecord[]>): Promise<ProjectRecord[]> {
	if (isDesktop()) return read();
	await claimSharedProjects();
	const root = browserProjectsRoot();
	if (!root) return [];
	return (await read()).filter((record) => isProjectIn(root, record.dir));
}

function claimForGuest(project: ProjectInfo) {
	if (inGuestMode()) addGuestProject(project.id);
}

export async function checkProject(project: ProjectInfo): Promise<ProjectInfo | null> {
	const current = await getProject(project.dir);
	if (current) await updateProjectRecord(current);
	return current;
}

export async function refreshProject(dir: string): Promise<ProjectInfo | null> {
	const current = await getProject(dir);
	if (!current) return null;
	await updateProjectRecord(current);
	setProjectsRevision((revision) => revision + 1);
	return current;
}

export async function forgetProject(dir: string): Promise<void> {
	await forgetProjectRecord(dir);
	setProjectsRevision((revision) => revision + 1);
}

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

// `ref` is an id or, for older links and folders, a folder name; main gives an id-less folder one here.
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
		await rememberProject(project);
		return project;
	}
	return null;
}

// Creates the folder, and an `index.tsx` with an empty stage when nothing in it can be an entry.
export async function openProjectFolder(dir: string): Promise<ProjectInfo> {
	if (!isDesktop()) throw new Error('Opening a project folder isn\'t available in the browser.');

	const project = await mainBridge.call(MAIN_CHANNELS.PROJECTS_INIT, { dir });
	await remember(project);
	return project;
}

export async function getProject(dir: string): Promise<ProjectInfo | null> {
	if (!dir) return null;
	if (!isDesktop()) return browserGetProject(dir);
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_GET, { dir });
}

// The folder moves, so use the returned dir; the id and URL stay the same.
export async function renameProject(dir: string, displayName: string): Promise<ProjectInfo> {
	if (!dir) throw new Error('No project folder.');

	const project = isDesktop()
		? await mainBridge.call(MAIN_CHANNELS.PROJECTS_RENAME, { dir, displayName })
		: await browserRenameProject(dir, displayName);
	await moveProjectRecord(dir, project.dir);
	await remember(project);
	return project;
}

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

// Desktop: the system trash. Browser: files stay, marked trashed, for 30 days.
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

export async function listTrashedProjects(): Promise<ProjectRecord[]> {
	await purgeExpiredTrash();
	return ownProjects(listTrashedProjectRecords);
}

let purgingTrash: Promise<void> | null = null;

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

export async function restoreProject(dir: string): Promise<void> {
	if (!dir) throw new Error('No project folder.');
	if (!isDesktop()) await browserMarkTrashed(dir, null);
	await restoreProjectRecord(dir);
	setProjectsRevision((revision) => revision + 1);
}

export async function eraseProject(project: ProjectInfo): Promise<void> {
	if (!project.dir) throw new Error('No project folder.');
	if (!isDesktop()) await browserDeleteProject(project.dir);
	await forgetProject(project.dir);
	await forgetProjectBundle(project.id);
}

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

export const projectKey = (project: ProjectInfo): string => project.id || project.name;

export function compileProject(dir: string): Promise<CompileResult> {
	if (!isDesktop()) return browserCompileProject(dir);
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_COMPILE, { dir });
}

// No compile follows: the canvas already shows these values, and main keeps the write
// from reaching the watcher (see `noteContent` in the desktop's projects.ts).
export function writeProject(dir: string, edits: SourceEdit[]): Promise<WriteResult> {
	if (!isDesktop()) return Promise.resolve(browserWriteProject(edits));
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_WRITE, { dir, edits });
}

export function readProjectConfig(dir: string): Promise<unknown> {
	if (!isDesktop()) return browserReadConfig(dir);
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CONFIG_READ, { dir });
}

export function writeProjectConfig(dir: string, config: unknown): Promise<void> {
	if (!isDesktop()) return browserWriteConfig(dir, config);
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CONFIG_WRITE, { dir, config });
}

// The debounce is for throughput only: main filters the app's own writes by content, not timing.
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

// Another tab's writes and cloud sync are reported like outside edits; this tab's own writes never are.
// A hidden tab holds changes until shown, so a project edited elsewhere isn't reloaded at every save.
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
