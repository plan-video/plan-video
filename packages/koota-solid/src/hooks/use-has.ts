import { $internal, $relationPair, type Entity, type RelationPair, type Trait, type World } from 'koota';
import { createComputed, createSignal, onCleanup, type Accessor } from 'solid-js';
import { isWorld } from '../utils/is-world';
import { access, createStableTrait, type MaybeAccessor } from '../utils/reactive-args';
import { useWorld } from '../world/use-world';

export function useHas(
	target: MaybeAccessor<Entity | World | undefined | null>,
	trait: MaybeAccessor<Trait | RelationPair>
): Accessor<boolean> {
	const contextWorld = useWorld();
	const stableTrait = createStableTrait(trait);
	const [value, setValue] = createSignal(false);

	createComputed(() => {
		const currentTarget = access(target);
		const currentTrait = stableTrait();

		if (!currentTarget) {
			setValue(false);
			return;
		}

		const world = isWorld(currentTarget) ? currentTarget : contextWorld;
		const entity = isWorld(currentTarget) ? currentTarget[$internal].worldEntity : currentTarget;

		// Wildcard pairs like ChildOf('*') fire on every pair removal, and onRemove fires
		// before cleanup, so the removed target still counts: > 1 means other pairs remain.
		const isWildcard =
			!!(currentTrait as any)?.[$relationPair] && (currentTrait as RelationPair).target === '*';
		const wildcardRelation = isWildcard ? (currentTrait as RelationPair).relation : undefined;

		const onAddUnsub = world.onAdd(currentTrait, (e) => {
			if (e === entity) setValue(true);
		});

		const onRemoveUnsub = world.onRemove(currentTrait, (e) => {
			if (e !== entity) return;
			if (wildcardRelation) {
				setValue(entity.targetsFor(wildcardRelation).length > 1);
			} else {
				setValue(false);
			}
		});

		setValue(entity.has(currentTrait));

		onCleanup(() => {
			onAddUnsub();
			onRemoveUnsub();
		});
	});

	return value;
}
