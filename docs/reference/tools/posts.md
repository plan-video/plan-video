# Social posts

The posting tools are the same ones an agent gets from the MCP server. They write to the calendar in the running app. Scheduling does not publish.

`planvideo post accounts` lists connected accounts. Use those ids. A platform with more than one account has to be named by id. The result never includes a token.

`planvideo post schema [platform]` is the caption limit, the media each platform accepts, and whether Plan Video can send to it. One caption is stored for every platform on a post.

`planvideo post schedule` saves a post. Pass a day and a time, or `--draft`. `--media` is one local video or picture. A remote URL is refused. TikTok, YouTube, Bluesky, LinkedIn and X stay on the calendar until `planvideo post publish`. Every other platform is stored and is not sent.

`planvideo post copy <id>` makes a new post from an existing one, posted or not: the same caption, platforms, accounts, file, link and platform settings, on a new day and time or as a draft. `--caption`, `--platform` and `--account` change them on the copy. The original stays as it is.

`planvideo post list` shows what is on the calendar, oldest first. `planvideo post update` changes a draft or a scheduled post. `planvideo post delete` removes one. A post that already went out stays as it went out.

`planvideo post publish <id>` sends that post now. Every platform on it has to be TikTok, YouTube, Bluesky, LinkedIn or X. TikTok and YouTube need a video attached; Bluesky, LinkedIn and X also send a picture, or the words alone, and the app has to stay open until the send finishes. It cannot be undone.
