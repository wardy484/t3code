# Manage environment files

T3 Code can track and edit existing text-based environment files on the machine running your T3 Code server. This is useful for `.env` files and other small secret files that your tools already load.

## Add a file

1. Open **Settings → Env files**.
2. Choose **Add file**.
3. Enter a name and the absolute path on the environment host, then save.

The file is not opened yet. Select it and choose **Reveal and edit** when you are ready to load its contents into the connected client.

## Edit a file

Edit the raw text, then choose **Save**. T3 Code preserves the file's permissions and ownership and rejects the save if another process changed the file after you revealed it. Discard or hide the editor to remove the revealed contents from the page.

T3 Code does not automatically load or source the file. A tool that uses it may need to be restarted after a change.

## Safety limits

- Only registered absolute paths can be opened.
- Files must be regular text files no larger than 1 MB.
- **Untrack** removes the path from T3 Code but never deletes the file.
- Env file management is available in the web, desktop, and mobile clients.
