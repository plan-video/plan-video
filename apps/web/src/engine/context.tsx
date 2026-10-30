/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, createRenderEffect, onCleanup, useContext, type JSX } from 'solid-js';
import { useColorMode } from '@kobalte/core';
import { WorldProvider } from '@plan.video/koota-solid';

import { createEngine, type Engine, type EngineOptions } from './create-engine';
import { setEditorTheme } from './theme';

const EngineContext = createContext<Engine>();

export interface EngineProviderProps {
	projectId: string;
	options?: EngineOptions;
	children?: JSX.Element;
}

/** Hands out the Engine only for lifecycle calls; components read state through world traits (see ./hooks). */
export function EngineProvider(props: EngineProviderProps): JSX.Element {
	const engine = createEngine(props.projectId, props.options);
	onCleanup(() => engine.dispose());

	const { colorMode } = useColorMode();
	createRenderEffect(() => setEditorTheme(engine.world, colorMode()));

	return (
		<EngineContext.Provider value={engine}>
			<WorldProvider world={engine.world}>
				{props.children}
			</WorldProvider>
		</EngineContext.Provider>
	);
}

export function useEngineContext(): Engine {
	const engine = useContext(EngineContext);

	if (!engine) {
		throw new Error('useEngineContext must be used within an EngineProvider');
	}

	return engine;
}
