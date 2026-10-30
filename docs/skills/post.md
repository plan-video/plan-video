# Scheduling posts

Plan Video is running and you are connected to its MCP server. These tools save posts on the calendar inside the app. They do not log into the social networks themselves.

- Call `social_accounts` first. Use the returned ids. If a platform has more than one account and the user did not name one, ask before scheduling. Never invent an id. Tokens are not in any result.
- Call `social_schema` before writing for a short platform (X, Bluesky, Threads). One caption is stored for the whole post. If it does not fit a platform, shorten it or leave that platform off.
- `schedule_post` never publishes. Pass a day (`YYYY-MM-DD`) and a time (`HH:MM`) in the time zone `social_accounts` reports, or `draft: true`. TikTok scheduled to the profile also needs `tiktok.privacy`, or `tiktok.inbox: true` to finish it in the TikTok app.
- Attach media with a local file path (`media`). Do not pass a web URL. One video, or a list of up to 35 pictures to go out together as a carousel: X and Bluesky take the first 4, LinkedIn 20, TikTok all 35.
- Do not call `publish_post` unless the user asked to publish now. It sends immediately to TikTok, YouTube, Bluesky, LinkedIn and X only, it cannot be undone, and Plan Video has to stay open until it finishes. A post dated in the future moves to now; if the send fails, that time is put back. Any other platform is kept on the calendar and is not sent. If the post includes one of those, say so instead of calling `publish_post`.
- After scheduling, tell the user the day, the time, the accounts, and that it has not been published.
- To post something again, call `copy_post` with its id and a new day and time. It keeps the caption, accounts, video or pictures and platform settings. Pass a caption or platforms only to change them.
- Posted posts cannot be edited or deleted. `update_post` and `delete_post` only change drafts and scheduled posts.
- `list_posts` is how you see what is already on the calendar, and whether a send succeeded or failed.
