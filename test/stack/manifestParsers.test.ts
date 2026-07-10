import { describe, expect, test } from "bun:test";
import {
  parseCargoDependencies,
  parseGoModDependencies,
  parsePipfileDependencies,
  parsePyprojectDependencies,
  parseRequirementsDependencies,
  parseSetupPyDependencies,
  pythonRequirementName,
} from "../../src/stack/context/manifestParsers.js";

describe("focused manifest parsers", () => {
  test("parses only go.mod require directives", () => {
    expect(
      parseGoModDependencies(`
module example.test/project

// github.com/gin-gonic/gin is documentation, not a dependency.
require github.com/spf13/cobra v1.9.1
require (
  github.com/charmbracelet/bubbletea v1.3.4
  "github.com/labstack/echo" v4.13.3 // indirect
)
replace github.com/gofiber/fiber => ../fiber
exclude github.com/gin-gonic/gin v1.10.0
`),
    ).toEqual([
      "github.com/charmbracelet/bubbletea",
      "github.com/labstack/echo",
      "github.com/spf13/cobra",
    ]);
  });

  test("parses Cargo dependency tables, dotted keys, targets, and workspace deps", () => {
    expect(
      parseCargoDependencies(`
[dependencies]
tokio = "1"
renamed-serde = { package = "serde", version = "1" }

[dev-dependencies.pretty_assertions]
version = "1"

[build-dependencies]
cc = "1"

[target.'cfg(unix)'.dependencies]
axum = "0.8"

[workspace.dependencies]
actix-web = "4"

[workspace.dependencies.tracing]
version = "0.1"

[package.metadata.dependencies]
serde_json = "1"
`),
    ).toEqual([
      "actix-web",
      "axum",
      "cc",
      "pretty_assertions",
      "serde",
      "tokio",
      "tracing",
    ]);
  });

  test("parses focused pyproject dependency containers", () => {
    expect(
      parsePyprojectDependencies(`
[project]
dependencies = ["Django>=5", "FastAPI[standard] ~= 0.115"]

[project.optional-dependencies]
test = ["PyTest>=8"]

[dependency-groups]
lint = ["Ruff==0.12"]

[build-system]
requires = ["setuptools>=75"]

[tool.poetry.dependencies]
python = "^3.13"
Flask = "^3"

[tool.poetry.group.dev.dependencies]
Black = "^25"

[tool.pdm.dev-dependencies]
docs = ["mkdocs>=1"]

[tool.uv]
dev-dependencies = ["httpx>=0.28"]

[tool.hatch.envs.default]
dependencies = ["coverage[toml]"]

[tool.unrelated]
dependencies = ["homeassistant"]
`),
    ).toEqual([
      "black",
      "coverage",
      "django",
      "fastapi",
      "flask",
      "httpx",
      "mkdocs",
      "pytest",
      "ruff",
      "setuptools",
    ]);
  });

  test("normalises requirements and ignores comments, options, and URLs", () => {
    expect(
      pythonRequirementName("Foo_Bar[baz] ~= 1.2 ; python_version > '3'"),
    ).toBe("foo-bar");
    expect(
      parseRequirementsDependencies(`
# pytest must not be inferred from this comment
Django[postgres]>=5.1  # runtime
RUFF==0.12.1
-r other.txt
--index-url https://example.invalid/simple
https://example.invalid/archive.whl
FastAPI @ https://example.invalid/fastapi.whl
`),
    ).toEqual(["django", "fastapi", "ruff"]);
  });

  test("parses Pipfile package tables", () => {
    expect(
      parsePipfileDependencies(`
[packages]
Django = "*"
home_assistant = { version = "*", extras = ["recommended"] }

[dev-packages]
PyTest = "*"

[scripts]
ruff = "ruff check"
`),
    ).toEqual(["django", "home-assistant", "pytest"]);
  });

  test("setup.py accepts literal setup dependency lists only", () => {
    expect(
      parseSetupPyDependencies(`
outside = ["Django"]
install_requires = ["Flask"]

setup(
    name="sample",
    install_requires=["FastAPI>=0.115", "PyTest[testing]"],
    extras_require={
        "lint": ["Ruff", "Black>=25"],
    },
)
`),
    ).toEqual(["black", "fastapi", "pytest", "ruff"]);
    expect(
      parseSetupPyDependencies(`
deps = ["Django"]
setup(name="sample", install_requires=deps)
`),
    ).toEqual([]);
  });
});
