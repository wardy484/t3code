# Hand off work to another thread

Agents can hand an independent coding task to a new T3 Code thread with the
`delegate_work` tool. The new thread is a normal, visible thread: you can open
it, steer it, stop it, or continue the conversation yourself.

Delegated work starts immediately in its own Git worktree. The worktree is
based on the current thread's checked-out branch, so committed changes are
available to the new thread without sharing a working directory. Uncommitted
changes are not copied; the agent receives a warning when this applies.

The original agent can call `check_delegated_work` to review the delegated
thread's state, latest result, errors, branch, and worktree. T3 Code also tells
the original agent about newly started work on its next turn so that it does
not accidentally duplicate the task.

While delegated threads are active, the sidebar places them beneath a compact
version of their parent thread. You can settle each delegated thread on its
own, or settle the parent to settle the whole group. If any thread in the group
is still working or waiting for you, T3 Code leaves the entire group active.

## Jira tickets

Starting work from a Jira ticket uses the same thread relationship. The Jira
card changes from **Start work** to **Open thread**, and agent status checks
include the ticket key and link. Existing Jira-started threads continue to be
recognized.
