// group/outport: a subsystem's output, as a block inside it.

#include "../through.hpp"

namespace paperboat::toolkit::group {
void add_outport(Registry& registry) { add_port(registry, false); }
}  // namespace paperboat::toolkit::group
