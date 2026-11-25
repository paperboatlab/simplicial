#pragma once

// What a client reads from a session's socket: a `signals` batch is its signal messages one
// after another, as every client takes it.

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

inline void receive(std::vector<nlohmann::json>& into, const std::string& text) {
  auto message = nlohmann::json::parse(text);
  if (message.is_object() && message.value("type", "") == "signals") {
    for (auto& one : message["list"]) into.push_back(std::move(one));
  } else {
    into.push_back(std::move(message));
  }
}
