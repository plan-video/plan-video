import { useWorld } from "@plan.video/koota-solid";
import { getRuntimeDocument } from "@plan.video/reconciler";

export function useDocument() {
  const world = useWorld();
  return () => getRuntimeDocument(world);
}
