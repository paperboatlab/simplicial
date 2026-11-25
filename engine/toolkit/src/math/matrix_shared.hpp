#pragma once

// Shared by the math package's matrix blocks: MATLAB-style matrix text, Eigen conversion, and
// the shape checks a block reports as a run error.

#include <Eigen/Core>
#include <Eigen/LU>

#include <cctype>
#include <cmath>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "common.hpp"

namespace paperboat::toolkit::math {

// A matrix is a rectangular Table (rows of columns), the toolkit's table value.
inline Table parse_matrix(std::string_view text, std::string_view param) {
  return paperboat::toolkit::parse_matrix_rows(text, param);
}

inline std::size_t rows(const Table& matrix) { return matrix.size(); }
inline std::size_t columns(const Table& matrix) { return matrix.empty() ? 0 : matrix.front().size(); }

inline Table matrix_at(const Values& in, std::string_view port) {
  const Table* matrix = get_if<Table>(in, port);
  return matrix ? *matrix : Table{};
}

inline void require_rectangular(const Table& matrix, std::string_view name) {
  if (matrix.empty()) return;
  for (std::size_t i = 0; i < matrix.size(); ++i)
    if (matrix[i].size() != matrix.front().size())
      throw std::invalid_argument(std::string(name) + ": row " + std::to_string(i) + " has " +
                                  std::to_string(matrix[i].size()) + " columns, expected " +
                                  std::to_string(matrix.front().size()));
}

inline Eigen::MatrixXd to_eigen(const Table& matrix, std::string_view name) {
  require_rectangular(matrix, name);
  Eigen::MatrixXd out(static_cast<Eigen::Index>(rows(matrix)), static_cast<Eigen::Index>(columns(matrix)));
  for (std::size_t i = 0; i < rows(matrix); ++i)
    for (std::size_t j = 0; j < columns(matrix); ++j) out(static_cast<Eigen::Index>(i), static_cast<Eigen::Index>(j)) = matrix[i][j];
  return out;
}

inline Table to_table(const Eigen::MatrixXd& matrix) {
  Table out(static_cast<std::size_t>(matrix.rows()), std::vector<double>(static_cast<std::size_t>(matrix.cols())));
  for (Eigen::Index i = 0; i < matrix.rows(); ++i)
    for (Eigen::Index j = 0; j < matrix.cols(); ++j) out[static_cast<std::size_t>(i)][static_cast<std::size_t>(j)] = matrix(i, j);
  return out;
}

}  // namespace paperboat::toolkit::math
