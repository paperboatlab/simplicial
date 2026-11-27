<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/banner-dark.webp">
    <img src=".github/readme/banner-light.webp" width="411" alt="Paperboat Simplicial">
  </picture>
</h1>

Visual flow, station and block-diagram simulation: a C++20/Python/Julia engine, a web UI and toolkits ([simplicial-toolkit-*](https://github.com/paperboatlab?q=simplicial-toolkit)). Part of [Paperboat](https://github.com/paperboatlab/paperboat).

**Status:** being rebuilt from the ground up on the new platform ([paperboat](https://github.com/paperboatlab/paperboat): runtimes in containers; [paperboat-ui](https://github.com/paperboatlab/paperboat-ui): the rebrand). The previous version, to copy from: [paperboat-legacy](https://github.com/paperboatlab/paperboat-legacy) (engine and `apps/web`).

**Docs:** <https://paperboatlab.org/apps/simplicial/> (sources in [`docs/`](docs/))

## Install

```sh
paperboat app install simplicial
paperboat app open simplicial ~/flows       # or: bin/simplicial ~/flows --port 30471
```

From a checkout (the engine built in `engine/build`, the page in `web/dist`): `paperboat app install simplicial --from .`.
Pushing a tag `v<version>` (package.json's) publishes the release `app install` downloads ([release.yml](.github/workflows/release.yml), Linux x86_64).

## The page

```sh
npm ci
npm run build       # web/dist/; npm run dev rebuilds on change
```

Serve `web/dist/` and open it with `?station=ws://localhost:<port>` (a station started with
`engine/build/scratchpad/paperboat-scratchpad --port <port>`). Its layout: [ARCHITECTURE.md](ARCHITECTURE.md).

## Check

```sh
npm run typecheck && npm test
npm run e2e         # open, edit, save, reopen in a headless Chromium; needs engine/build and web/dist
```

[ci.yml](.github/workflows/ci.yml) builds and tests the engine, runs the e2e on it, checks the protocol types and checks the page on every pull request.

## Licence

GNU General Public License version 3 (see [LICENSE](LICENSE)).
