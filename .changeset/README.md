# Changesets

Each package is versioned independently. Bumping one package does not bump the others, except that a dependent gets a patch when its range on the bumped package no longer matches (see `updateInternalDependencies` in `config.json`).

- Add a changeset for every change that should be released: `pnpm changeset`.
- Pick only the packages whose public behaviour changed.
- Dependencies use `workspace:^`, so a published package depends on `^<current version>` of its internal dependencies.

Releases run from `main` through `.github/workflows/release.yml`.
