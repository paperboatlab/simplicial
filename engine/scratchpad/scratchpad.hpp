#pragma once

// The scratchpad: a station with the standard toolkits and no domain. Flow and Board
// work as they are (a Simulink-style scratchpad); the Station page has nothing to show.
// It listens on the engine's default port (51301), so the web app connects to it as it is.

#include "paperboat/core/server.hpp"
#include "paperboat/toolkit/descriptor.hpp"

namespace paperboat::scratchpad {

// The scratchpad's catalog: base, math, signal, control and board, with no domain
// blocks. Static, because catalog entries point into it for as long as the server runs.
const toolkit::Catalog& catalog();

// The station that serves the catalog. Static too, for the same reason.
const core::Station& station();

}  // namespace paperboat::scratchpad
