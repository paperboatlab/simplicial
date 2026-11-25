#include <paperboat/sdk.hpp>

#include "scratchpad.hpp"

int main(int argc, char** argv) {
  // 51301 is the engine's default station port, so the web app's default URL points here.
  return paperboat::core::main(paperboat::scratchpad::station(), argc, argv, 51301);
}
