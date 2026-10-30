/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A project has three names that come apart: the id (the URL, the world's key), the
// folder (moves on rename) and the display name.

import { createContext, createMemo, createSignal, useContext, type Accessor, type JSX } from 'solid-js';

import { refreshProject, renameProject } from '@/projects';

import type { ProjectInfo } from '@/projects';

export type ProjectContextValue = {
	id: Accessor<string>;
	dir: Accessor<string>;
	name: Accessor<string>;
	rename: (displayName: string) => Promise<void>;
	refresh: () => Promise<void>;
};

const ProjectContext = createContext<ProjectContextValue>();

export function ProjectProvider(props: { project: ProjectInfo; children: JSX.Element }) {
	// Seeded once: the subtree is keyed on the project, so another one arrives as a new provider.
	const [info, setInfo] = createSignal(props.project);

	// Memos, not plain reads: `dir` re-mounts the scene when it changes, and a
	// refresh that found nothing new must not look like a move.
	const id = createMemo(() => info().id);
	const dir = createMemo(() => info().dir);
	const name = createMemo(() => info().displayName);

	const rename = async (displayName: string): Promise<void> => {
		setInfo(await renameProject(dir(), displayName));
	};

	const refresh = async (): Promise<void> => {
		const next = await refreshProject(dir());
		if (next) setInfo(next);
	};

	return (
		<ProjectContext.Provider value={{ id, dir, name, rename, refresh }}>
			{props.children}
		</ProjectContext.Provider>
	);
}

export function useProject(): ProjectContextValue {
	const project = useContext(ProjectContext);
	if (!project) throw new Error('useProject must be used within a ProjectProvider');
	return project;
}
