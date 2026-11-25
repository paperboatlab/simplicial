<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/banner-dark.webp">
    <img src=".github/readme/banner-light.webp" width="411" alt="Paperboat Simplicial">
  </picture>
</h1>

Visual flow, station and block-diagram simulation: a C++20/Python/Julia engine, a web UI and toolkits ([simplicial-toolkit-*](https://github.com/paperboatlab?q=simplicial-toolkit)). Part of [Paperboat](https://github.com/paperboatlab/paperboat).

**Status:** being rebuilt from the ground up on the new platform ([paperboat](https://github.com/paperboatlab/paperboat): runtimes in containers; [paperboat-ui](https://github.com/paperboatlab/paperboat-ui): the rebrand). The previous version, to copy from: [paperboat-legacy](https://github.com/paperboatlab/paperboat-legacy) (engine and `apps/web`).

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
```

[ci.yml](.github/workflows/ci.yml) builds and tests the engine, checks the protocol types and checks the page on every pull request.

## Licence

GNU General Public License version 3 (see [LICENSE](LICENSE)).
