# Jira Tickets

T3 Code can show a Jira Cloud board beside your threads. The board supports filtering by assignee
or Epic, moving issues through available Jira workflow transitions, and starting an agent thread
from a ticket.

## Connect Jira

Open **Settings → Integrations → Jira** on a client connected to the environment that will host the
integration.

1. Enter the Jira site URL, account email, and an API token.
2. Select **Test connection**, then choose an available board.
3. Choose the T3 project and base branch used by **Start**.
4. Optionally enter JQL to narrow the selected board's saved filter.
5. Select **Save**.

The API token is stored in the environment's protected server-side secret store. Clients can see
that a token is present but cannot read it back. Reopen the integration to change its configuration,
replace the token, test the connection, or disconnect Jira.

The token needs permission to browse the configured board and issues. Starting an unassigned ticket
requires **Assign issues**, and moving cards requires **Transition issues**.

## Manual configuration

For headless installations, Jira can also be configured directly on the server.

Create `jira.json` in the T3 Code userdata directory on the machine running the server. For a normal
installation, this is `~/.t3/userdata/jira.json`:

```json
{
  "baseUrl": "https://your-company.atlassian.net",
  "email": "you@example.com",
  "boardId": 123,
  "jql": "project = KG AND statusCategory != Done ORDER BY Rank ASC",
  "projectPath": "/absolute/path/to/your/project",
  "baseBranch": "main"
}
```

Set the Jira Cloud API token in the server process environment, then restart T3 Code:

```bash
export T3CODE_JIRA_API_TOKEN="your-api-token"
```

The token stays on the server and is never sent to T3 Code clients. Settings-managed credentials
take precedence over this environment variable.

When both settings are available, **Tickets** appears below Search in the sidebar.

## Start work from a ticket

Select **Start** on a card. If the ticket is unassigned, T3 Code assigns it to the Jira account that
owns the API token. It then opens a new worktree draft for `projectPath`, using `baseBranch` as its
starting point, and fills the composer with the issue summary, description, and Jira link.

Tickets in Review use **Review** to start a review-focused thread. Done columns do not offer a
thread action.

The worktree branch and pull request title follow these conventions:

```text
branch: KG-3345-title-of-ticket
PR title: [KG-3345] Title of Ticket
```

The draft is left ready for review before you send it to the agent.

## Tickets surfaced in a thread

On web and desktop, Jira ticket keys mentioned by an agent appear as cards in that thread's
**Tickets** right panel. Each card shows the current Jira title and status and links back to Jira.
The cards stay in the panel rather than appearing as extra messages in the conversation.

Select **Start work** to assign an unassigned ticket to your Jira account, create a worktree thread
with the ticket description and delivery conventions, and start its first turn immediately. The
action changes to **Open thread** once work starts. T3 Code records the source thread, ticket, and
work thread together and rejects duplicate starts for the same ticket.

The source agent is not interrupted. On its next turn, it receives private context telling it that
work has already started and which ticket is being handled, so it does not duplicate the work.

## Notes

- The board columns come from the configured Jira board. Leave JQL blank to load active sprint
  issues when available, falling back to the board's saved filter. Provide JQL to override this.
- **My work** compares each issue with the Jira account that owns the API token.
- Epic filtering uses Jira's parent relationship.
- Dragging a card only works when Jira offers a workflow transition into the target column.
- T3 Code loads up to 500 matching issues to keep the board responsive.
