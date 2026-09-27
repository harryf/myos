# Conventions

How Harry's recurring work is done. Loaded on demand; edit freely, upgrades never touch this file.

## Publishing

- Publish a page with `~/bin/publish <file> <name> --private -y`.
- It goes live at https://harryf.github.io/private/<name>.html (unlisted).
- Republish the same way after any change to the page.

## Grist

- A public editable doc gets access rules for non owners before anyone gets the link: no delete, no structure changes.
- Writes go through curl: `PUT` upsert keyed on an id column, never a blind add.
- Every write is read back (a GET of the same row) before it counts as done.

## Repos

- Private single author repos commit straight to main.
- Public repos use branches and pull requests.

## Verification

- Web work is checked in a real browser: Interceptor when it is connected, Claude-in-Chrome otherwise.
- Say which one was used, at which widths, and what the console showed.
