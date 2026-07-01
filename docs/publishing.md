# Publishing OpsCanon

The package is published on npm as `opscanon`.

## Local Publish

```bash
npm login
npm whoami
npm publish
```

Before publishing, verify:

```bash
npm publish --dry-run
```

## GitHub Action Publish

The repository includes `.github/workflows/publish.yml`.

To use it:

1. Create or choose an npm automation token.
2. Add it as a GitHub repository secret named `NPM_TOKEN`.
3. Run the `Publish` workflow manually.
4. Keep `dry-run` set to `true` for verification.
5. Set `dry-run` to `false` only when ready to publish.

The workflow runs `npm publish --provenance` for the real publish step.

## Current Status

`opscanon@0.1.0` is live on npm. Local `npm whoami` should return the publishing account before future releases.
