import { describe, expect, it } from 'vitest';

import { createPointer } from './pointer';

const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) } as HTMLCanvasElement;

const event = (clientX: number, buttons: number, button = 0) => ({ clientX, clientY: 0, button, buttons }) as PointerEvent;

function holdDrag() {
  const pointer = createPointer({ canvas });
  pointer.down(event(10, 1));
  pointer.reset();
  pointer.move(event(40, 1));
  return pointer;
}

describe('timeline pointer', () => {
  // The release can happen outside the window or on an element that swallows it.
  it('ends a drag whose release was never heard, where the button was last held', () => {
    const pointer = holdDrag();

    pointer.move(event(300, 0));

    expect(pointer.position).toMatchObject({ state: 'lifted', currentX: 40, deltaX: 30 });
  });

  it('ends a drag the browser cancels', () => {
    const pointer = holdDrag();

    pointer.cancel();

    expect(pointer.position).toMatchObject({ state: 'lifted', currentX: 40 });
  });

  it('keeps dragging while the button is held', () => {
    const pointer = holdDrag();

    pointer.move(event(300, 1));

    expect(pointer.position).toMatchObject({ state: 'pressing', currentX: 300 });
  });
});
