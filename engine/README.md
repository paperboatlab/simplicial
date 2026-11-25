# engine

The C++20 engine and CLI of [Simplicial](../README.md): built-in toolkits, the generic station host,
the `paperboat/0` WebSocket session server and the `paperboat` command-line tool.

**Docs:** <https://paperboatlab.github.io/paperboat/cpp.html> (sources in paperboat-legacy's [`docs/api/`](https://github.com/paperboatlab/paperboat-legacy/tree/dev/docs/api))

## Layout

```text
toolkit/   paperboat::toolkit: built-in block and station packages, plugin loader and descriptor parser
core/      paperboat::core: Station, Flow graph scheduler, solvers and WebSocket server
tools/     paperboat CLI, paperboat-scratchpad and paperboat-catalog binaries
tests/     Catch2 test suite and SDK test stations
```

## Build

Requires CMake 3.25+, Ninja and a C++20 compiler:

```sh
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

## Check

```sh
ctest --test-dir build --output-on-failure
```
