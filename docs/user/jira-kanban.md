# Boards and Jira

T3 Code boards keep work separated by organisation and project. An organisation owns boards, a
project belongs to one organisation, and each board is explicitly assigned to the projects where
it should appear. A ticket from one organisation therefore cannot appear in an unrelated project.

Boards can be native T3 boards or Jira Cloud boards. Both support moving cards and starting agent
threads from work. Native boards also support creating and deleting cards in T3 Code.

## Where boards live

Organisations and boards are stored by the T3 environment selected under **Settings →
Integrations**. This works for local and remote environments: the machine running that T3 server
owns the data and credentials, while connected web, desktop, and mobile clients use the same
server-side catalogue.

Organisations do not currently span environments. Create an organisation separately on each server
that should host it.

## Set up organisations and projects

1. Open **Settings → Integrations** and select the environment that will host the boards.
2. Create an organisation, such as `T3 Code` or `Tutorful`.
3. Select the projects that belong to it.

A project can belong to only one organisation. Moving it to another organisation removes its old
board assignments, which prevents cards from the old organisation continuing to appear there.

## Add a T3 board

Under **T3 boards**, choose an organisation, name the board, select its projects, and choose the
base branch used by **Start**. New boards contain **Todo**, **In Progress**, and **Done** columns.

Open **Boards** from the sidebar to create cards, drag them between columns, delete them, or start a
worktree thread from a card.

## Add a Jira board

Under **Jira boards**:

1. Choose the organisation that owns the Jira connection.
2. Enter the Jira site URL, account email, and API token.
3. Load the available Jira boards and select one.
4. Select exactly which organisation projects can use the board.
5. Choose the base branch and, optionally, a JQL override.
6. Add the board.

The API token is stored in that environment's protected server-side secret store and is shared by
the Jira boards in the organisation. An organisation connects to one Jira site and account, but can
contain multiple boards from that connection. The token is never returned to clients. It needs
permission to browse the configured boards and issues. Starting unassigned work requires **Assign
issues**, and moving cards requires **Transition issues**.

Leave JQL blank to load an active sprint when available, falling back to the board's saved filter.
Provide JQL to override that behavior. T3 Code loads up to 500 matching issues per board.

## Start work from a card

Select **Start** on a card. Jira cards are assigned to the Jira account first when they are
unassigned. T3 Code then creates a worktree in the selected project using the board's base branch
and fills the first prompt with the card details.

Jira cards in Review offer **Review** and create a review-focused thread. Done columns do not offer
a thread action. Jira branch and pull request titles follow these conventions:

```text
branch: KG-3345-title-of-ticket
PR title: [KG-3345] Title of Ticket
```

## Tickets surfaced in a thread

On web and desktop, Jira keys mentioned by an agent appear in that thread's **Tickets** panel only
when the Jira board is assigned to the thread's exact environment and project. The panel can start
work or reopen an existing related thread without querying boards from another project.

## Existing Jira configuration

An existing single-board `jira.json` configuration is imported automatically the first time the
new board catalogue loads. T3 Code creates an organisation for the Jira site, imports its board,
and assigns the project matching `projectPath`. The existing protected token is reused.

Headless installations can still provide the legacy file at `~/.t3/userdata/jira.json` and the Jira
token through `T3CODE_JIRA_API_TOKEN` before that first import:

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
