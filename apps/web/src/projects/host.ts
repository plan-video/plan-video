/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createRoot, createSignal, on } from 'solid-js';

import { addGuestProject, inGuestMode } from '@/lib/guest';
import { keepBrowserStorage } from '@/lib/persistent-storage';
import {
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

import type { CompileResult, ProjectInfo, SourceEdit, WriteResult } from './types';
import type { ProjectRecord } from '@/lib/db';

export type { CompileResult, ProjectInfo, ProjectRecord, SourceEdit, WriteResult };

export const projectsRoot = browserProjectsRoot;

const [projectsRevision, setProjectsRevision] = createSignal(1);

export { projectsRevision };

createRoot(() => createEffect(on(browserProjectsRoot, () => setProjectsRevision((revision) => revision + 1), { defer: true })));

export function markProjectsChanged(): void {
	setProjectsRevision((revision) => revision + 1);
}

async function remember(project: ProjectInfo): Promise<void> {
	await rememberProject(project);
	setProjectsRevision((revision) => revision + 1);
}

export async function getProjectsRoot(): Promise<string | null> {
	return projectsRoot();
}

export async function ensureProjectsRoot(): Promise<string | null> {
	return browserProjectsRoot();
}

export async function listProjects(): Promise<ProjectRecord[]> {
	await purgeExpiredTrash();
	return ownProjects(listProjectRecords);
}

// Never list projects of someone who signed in on this browser before.
async function ownProjects(read: () => Promise<ProjectRecord[]>): Promise<ProjectRecord[]> {
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
	const project = await browserCreateProject(root, displayName);
	claimForGuest(project);
	await remember(project);
	return project;
}

// `ref` is an id or, for older links, a folder name.
export async function resolveProject(ref: string): Promise<ProjectInfo | null> {
	if (!ref) return null;

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

export async function getProject(dir: string): Promise<ProjectInfo | null> {
	if (!dir) return null;
	return browserGetProject(dir);
}

// The folder moves, so use the returned dir; the id and URL stay the same.
export async function renameProject(dir: string, displayName: string): Promise<ProjectInfo> {
	if (!dir) throw new Error('No project folder.');

	const project = await browserRenameProject(dir, displayName);
	await moveProjectRecord(dir, project.dir);
	await remember(project);
	return project;
}

export async function duplicateProject(dir: string): Promise<ProjectInfo> {
	if (!dir) throw new Error('No project folder.');

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

// The files stay, marked trashed, for 30 days.
export async function deleteProject(dir: string): Promise<void> {
	if (!dir) throw new Error('No project folder.');

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
	await browserMarkTrashed(dir, null);
	await restoreProjectRecord(dir);
	setProjectsRevision((revision) => revision + 1);
}

export async function eraseProject(project: ProjectInfo): Promise<void> {
	if (!project.dir) throw new Error('No project folder.');
	await browserDeleteProject(project.dir);
	await forgetProject(project.dir);
	await forgetProjectBundle(project.id);
}

export async function eraseProjectsById(ids: readonly string[]): Promise<void> {
	if (!ids.length) return;
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
	return browserCompileProject(dir);
}

// No compile follows: the canvas already shows these values.
export function writeProject(edits: SourceEdit[]): Promise<WriteResult> {
	return Promise.resolve(browserWriteProject(edits));
}

export function readProjectConfig(dir: string): Promise<unknown> {
	return browserReadConfig(dir);
}

export function writeProjectConfig(dir: string, config: unknown): Promise<void> {
	return browserWriteConfig(dir, config);
}

// Another tab's writes and cloud sync are reported like outside edits; this tab's own writes never are.
// A hidden tab holds changes until shown, so a project edited elsewhere isn't reloaded at every save.
export function watchProject(dir: string, onChange: (paths: string[]) => void, debounceMs = 80): () => void {
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
