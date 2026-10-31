# @plan.video/dapi

The tools agents use to plan and publish posts: one entry per tool with its name, description, and zod input and output schemas. The dashboard's Assistant validates its calls against them, and `services/mcp` and `services/agent` build their tool lists from `src/tools`, so each tool is described once.

```ts
import { toolByName } from "@plan.video/dapi";
import type { ToolArgs } from "@plan.video/dapi";

const args: ToolArgs<"list_posts"> = toolByName("list_posts").input.parse({});
```

The package is free of Node built-ins so the browser can import it.
