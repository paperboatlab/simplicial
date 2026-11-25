#pragma once

// group: an In or Out block passes its value through unchanged, of any type.

#include <string>
#include <utility>

#include "common.hpp"

namespace paperboat::toolkit::group {

/** The port facing outside the group: the group's own port, which the UI doesn't draw inside it. */
inline constexpr const char* kOuter = "outer";

class Through final : public Block {
 public:
  Through(std::string from, std::string to) : from_(std::move(from)), to_(std::move(to)) {}
  Values step(const Context&, const Values& in) override {
    const auto it = in.find(from_);
    return {{to_, it != in.end() ? it->second : Value{0.0}}};
  }

 private:
  std::string from_, to_;
};

/** In (`inport`: outside → y) or Out (`outport`: u → outside), named by its `name` param. */
inline void add_port(Registry& registry, bool into) {
  Template t;
  t.name = into ? "group/inport" : "group/outport";
  t.def.type = into ? "inport" : "outport";
  t.def.label = into ? "In" : "Out";
  t.def.kind = Kind::Function;
  const std::string from = into ? kOuter : "u", to = into ? "y" : kOuter;
  t.def.inputs = {{.id = from, .type = "any"}};
  t.def.outputs = {{.id = to, .type = "any"}};
  t.def.params = {{.id = "name", .type = "text", .default_text = ""}};
  t.def.description = into ? "An input of the subsystem or story it is in: a port on the group's block outside, named by name, and its value here."
                           : "An output of the subsystem or story it is in: what is wired to it leaves by a port on the group's block outside, named by name.";
  t.def.view = {.compact = true, .glyph = into ? "in" : "out", .value = "{name}"};
  t.make = [from, to](const Values&, const Config&) { return std::make_unique<Through>(from, to); };
  registry.add(std::move(t));
}

}  // namespace paperboat::toolkit::group
