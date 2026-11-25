math
====

Pointwise arithmetic and math on signals, special functions and matrices. All but the two random
blocks and the matrix blocks are `elementwise <https://paperboatlab.github.io/paperboat/concepts.html#elementwise>`_: wire a vector in
and each output is a vector.

.. toctree::
   :maxdepth: 1

   blocks/index

Special functions
-----------------

``erf``, ``gamma`` (gamma, log-gamma, digamma), ``bessel`` (J, Y, I, K of any order) and
``distribution`` (normal, uniform or exponential; pdf, cdf or quantile) come from Boost.Math.

Matrices
--------

Matrices travel on signal ports as a rectangular table: ``matrix_constant`` (``"1 2; 3 4"``,
MATLAB style), ``transpose``, ``inverse`` (a singular or non-square matrix fails),
``determinant``, ``multiply`` (inner dimensions must agree), ``solve`` (A·x = B, MATLAB's
``A \ B``), ``scale``, ``identity`` and ``size``. They use Eigen (MPL-2.0, header-only; a private
dependency of the toolkit).
