#include <paperboat/sdk.hpp>

int main(int argc, char** argv) {
  static const paperboat::Registry registry = paperboat::builtins();
  static const paperboat::Catalog catalog = paperboat::load_descriptor_file(PAPERBOAT_DESCRIPTOR, registry);
  return paperboat::main({.engine = "cpp-sdk-station", .catalog = &catalog}, argc, argv, 8781);
}
