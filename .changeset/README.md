# Changesets

Every pull request that changes a published package needs a changeset. It says which packages changed, how big the change is and what the release notes should say.

Run this and answer the questions:

```sh
npm run changeset
```

Commit the new file in `.changeset/` with your pull request. When it is merged, a bot opens a "version packages" pull request. Merging that one releases the packages to npm.

Choose the size of the change like this:

- **patch**: a bug fix or an internal change that users do not notice
- **minor**: a new feature that doesn't break anything
- **major**: a change that breaks existing code

More about changesets: https://github.com/changesets/changesets
