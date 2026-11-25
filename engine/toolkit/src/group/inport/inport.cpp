// group/inport: a subsystem's input, as a block inside it.

#include "../through.hpp"

namespace paperboat::toolkit::group {
void add_inport(Registry& registry) { add_port(registry, true); }
}  // namespace paperboat::toolkit::group
