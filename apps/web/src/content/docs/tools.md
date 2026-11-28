These are the tools plan.video gives your agent. You don't need to call them yourself; your agent picks them when you ask for something.

| Tool | What it does |
| --- | --- |
| `social_accounts` | Lists your connected accounts, how many more scheduled posts each can take, and your time zone. |
| `social_schema` | Each network's rules: caption limit, what it accepts and whether plan.video can post to it. |
| `tiktok_creator` | What a TikTok account can post right now: who can watch, whether comments, Duet and Stitch can be on, and the longest video. |
| `analytics` | Views, likes and comments from TikTok, YouTube, Instagram, Facebook Pages, Threads and LinkedIn Pages, how posts did by day and hour, and your top posts. |
| `list_media` | Lists the videos and pictures in your media library. |
| `schedule_post` | Saves a post on your calendar as a draft, or scheduled for a time, when it goes out on its own. It can repeat, and on X, Bluesky and LinkedIn it can have up to 10 follow-ups. |
| `copy_post` | Makes a new post from an existing one, on a new day or as a draft. |
| `list_posts` | Lists posts on your calendar, with their status and whether they went out. |
| `update_post` | Changes a draft or a scheduled post, or takes a scheduled one back to a draft. A post still scheduled goes out at its time. |
| `ask_for_approval` | Holds a post until a client or your team approves it, and gives the link to send them. |
| `delete_post` | Deletes a draft or a scheduled post. |
| `publish_post` | Sends a saved post now, to one account per network. |

## What agents can't do

- **Change or delete posts that have gone out.** The network already has them.
- **Attach files from your computer.** Only files in your [media library](/docs/media-library) can be attached.
- **See your logins.** Network tokens are never sent to agents.
- **Edit videos.** Editing with an agent isn't available yet.
- **Give each network its own caption.** A post has one caption, so ask for one post per network instead.
- **Use Auto-schedule.** Agents always give a day and time.
- **Filter by failed posts.** `list_posts` shows draft, scheduled and posted, and says whether each send worked.

<Warning>
`publish_post` sends a post straight away and can't be undone. plan.video marks it, `delete_post`, `update_post` and `ask_for_approval` as actions that can't be taken back, so your agent's app asks you before it runs them.
</Warning>
