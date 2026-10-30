/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';

import { GeometryType } from '../constants';
import { ChildOf, Computed, Delay, Geometry, Group, Root, Scene, Sequential, Trim } from '../traits';
import { createRuntimeWorld } from '../world/create-world';
import { store } from '../world/store';
import { createEntity } from './entities';
import { appendChild, removeChild } from './hierarchy';

import type { Entity } from 'koota';

const seconds = (value: number) => value * 30;

/** A scene on a fresh stage, and ways to fill it, at the default 30 fps. */
function setup() {
	const world = createRuntimeWorld('timing');
	const scene = createEntity(world);
	scene.add(Geometry({ value: GeometryType.RECT }));
	scene.add(Scene);
	scene.add(ChildOf(world.get(Root)!));

	const span = (entity: Entity) => {
		const computed = store(world, Computed);
		return [computed.start[entity.id()], computed.end[entity.id()]];
	};
	const clip = (parent: Entity, length: number, delay = 0) => {
		const entity = createEntity(world);
		entity.add(Geometry({ value: GeometryType.RECT }));
		entity.add(Trim({ start: 0, end: seconds(length) }));
		if (delay) entity.add(Delay({ value: seconds(delay) }));
		appendChild(world, entity, parent);
		return entity;
	};
	const container = (parent: Entity, kind: typeof Group | typeof Sequential) => {
		const entity = createEntity(world);
		entity.add(kind);
		appendChild(world, entity, parent);
		return entity;
	};

	return { world, scene, span, clip, container };
}

describe('a container that fits its children', () => {
	it('is not made longer by an empty layer', () => {
		const { scene, span, clip, container } = setup();
		clip(scene, 3);
		container(scene, Sequential);
		expect(span(scene)).toEqual([0, seconds(3)]);
	});

	it('leaves out containers that hold only empty containers', () => {
		const { scene, span, clip, container } = setup();
		clip(scene, 3);
		const layer = container(container(scene, Group), Sequential);
		container(layer, Group);
		expect(span(scene)).toEqual([0, seconds(3)]);

		clip(layer, 5, 1);
		expect(span(scene)).toEqual([0, seconds(6)]);
	});

	it('keeps the default length with nothing in it', () => {
		const { scene, span, container } = setup();
		expect(span(scene)).toEqual([0, seconds(16)]);
		container(scene, Sequential);
		expect(span(scene)).toEqual([0, seconds(16)]);
	});

	it('shrinks when a clip in it is deleted', () => {
		const { scene, span, clip } = setup();
		clip(scene, 3);
		const longer = clip(scene, 5);
		longer.destroy();
		expect(span(scene)).toEqual([0, seconds(3)]);
	});

	it('loses the time of a split clip whose halves are both deleted', () => {
		const { scene, span, clip, container } = setup();
		clip(scene, 2);
		const layer = container(scene, Sequential);
		const head = clip(layer, 4);
		const tail = clip(layer, 4, 4);
		head.destroy();
		expect(span(scene)).toEqual([0, seconds(8)]);
		tail.destroy();
		expect(span(scene)).toEqual([0, seconds(2)]);
	});

	it('shrinks when a clip is moved out of it', () => {
		const { world, scene, span, clip, container } = setup();
		clip(scene, 3);
		const group = container(scene, Group);
		const moved = clip(group, 7);
		removeChild(world, moved, group);
		expect(span(scene)).toEqual([0, seconds(3)]);
	});

	it('leaves out a container whose own end is taken away', () => {
		const { scene, span, clip, container } = setup();
		clip(scene, 3);
		const group = container(scene, Group);
		group.add(Trim({ start: 0, end: seconds(10) }));
		expect(span(scene)).toEqual([0, seconds(10)]);
		group.remove(Trim);
		expect(span(scene)).toEqual([0, seconds(3)]);
	});
});
