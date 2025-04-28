cmake_minimum_required(VERSION 3.13)
project(PrimeKit LANGUAGES CXX)

include(FetchContent) # Include FetchContent module
FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3 # Or use a specific commit/latest tag
)
FetchContent_MakeAvailable(nlohmann_json)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Define the output name
set(EMSCRIPTEN_MODULE_NAME primekit)

# Set output directory relative to CMAKE_BINARY_DIR (the 'build' directory)
set(WASM_OUTPUT_DIR ${CMAKE_BINARY_DIR}/wasm_build)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${WASM_OUTPUT_DIR}) # For the final JS/WASM

# --- Project Sources ---
file(GLOB CPP_SOURCES "src/cpp/*.cpp")

# --- Target Definition ---
add_executable(${EMSCRIPTEN_MODULE_NAME} ${CPP_SOURCES})

# Link nlohmann_json (it's header-only, but provides an interface target)
target_link_libraries(${EMSCRIPTEN_MODULE_NAME} PRIVATE nlohmann_json::nlohmann_json)

# --- Minimal Emscripten Flags ---
# Apply necessary flags directly to the target for linking
target_link_options(${EMSCRIPTEN_MODULE_NAME} PRIVATE
    -sWASM=1
    -lembind
    # Add optimization only for Release builds
    "$<$<CONFIG:Release>:-O3>"
    # Basic module export settings needed for Embind usually
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sEXPORT_NAME=${EMSCRIPTEN_MODULE_NAME}Module
)

# --- Status Messages ---
message(STATUS "Project: ${PROJECT_NAME}")
message(STATUS "Output WASM/JS: ${WASM_OUTPUT_DIR}/${EMSCRIPTEN_MODULE_NAME}.wasm / .js")
