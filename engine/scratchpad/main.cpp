#include <paperboat/sdk.hpp>

#include "scratchpad.hpp"

int main(int argc, char** argv) {
  // 8765 is the engine's default station port, so the web app's default URL points here.
  return paperboat::core::main(paperboat::scratchpad::station(), argc, argv, 8765);
}
