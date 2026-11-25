# toolkit

Reusable C++20 block and station-object packages for the [Simplicial](../../README.md) engine.
Built-in packages (`base`, `signal`, `math`, `string`, `list`, `board`, `step`, `group`) ship
with the engine; optional toolkits (`control`, `optimization`, `opencv`, `meshop`) install into
`engine/toolkit/<name>/` or `~/.local/share/paperboat/toolkits/<name>/` as plugins.

**Docs:** <https://paperboatlab.org/#toolkits> and
<https://paperboatlab.org/paperboat/descriptor.html> (sources in `src/<package>/docs/` and
paperboat-legacy's [`docs/api/descriptor.rst`](https://github.com/paperboatlab/paperboat-legacy/blob/dev/docs/api/descriptor.rst))

## Layout

Each built-in package lives in `src/<package>/` with a `toolkit.toml` manifest and one directory per
block (`<block>/<block>.cpp`, optional `icon.hpp`, `doc.rst` and `web/`):

```text
src/
  base/        constants, logic, comparisons, timers, mux/demux and key inputs
  signal/      waves, ramps, noise and signal generators
  math/        arithmetic, trigonometry, vectors, matrices and FFT
  string/      string formatting and parsing
  list/        array and point-list operations
  board/   Display, Graph, Scope, Lamp, Switch, Choice and Speaker monitors
  step/        Step-flow sequencing blocks
  group/       Subsystems, frames and port blocks
```

## Check

List all registered templates and validate descriptors from the engine build directory:

```sh
../build/tools/paperboat-catalog --templates
ctest --test-dir ../build -R toolkit --output-on-failure
```
