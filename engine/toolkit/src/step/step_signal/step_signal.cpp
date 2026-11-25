// step/step_signal: the bridge from a step path to the signal layer, the mirror of signal_step.
//
// A path passing through sets its signal output `y` to `value` and goes straight on; `y` holds
// that value until a path passes again. Two of them (value 1, then 0) switch something on and
// off from a Step flow. Signal blocks see the new value a clock step later, as with any step's
// output.

#include <memory>
#include <string>

#include "common.hpp"
#include "step/flow_shared.hpp"

namespace paperboat::toolkit::step {
namespace {

class SetSignal final : public Step {
 public:
  explicit SetSignal(double value) : value_(value) {}
  Values outputs() const override { return {{"y", y_}}; }
  void enter(const Context&, const Values&) override { y_ = value_; }
  std::string tick(const Context&, const Values&) override { return "next"; }

 private:
  double value_;
  double y_ = 0.0;
};

}  // namespace

void add_step_signal(Registry& registry) {
  registry.add(make_step_template(
      "step_signal", "Step → Signal", {step_port("in")}, {step_port("next"), {"y"}},
      {{.id = "value", .default_value = 1.0}},
      [](const Values& p, const Config&) { return std::make_unique<SetSignal>(get_or(p, "value", 1.0)); },
      "Sets its signal y to value when a path passes, and holds it until one passes again."));
}

}  // namespace paperboat::toolkit::step
