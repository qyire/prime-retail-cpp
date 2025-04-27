cmake_minimum_required(VERSION 3.13)
project(PrimeKit LANGUAGES CXX)

# Require C++17
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Check if Emscripten toolchain is being used
if(NOT CMAKE_TOOLCHAIN_FILE)
    message(WARNING "Emscripten toolchain file not specified. Attempting to find Emscripten...")
    find_package(Emscripten)
    if(NOT EMSCRIPTEN_FOUND)
        message(FATAL_ERROR "Emscripten SDK not found. Please set EMSCRIPTEN_ROOT_PATH or provide the Emscripten toolchain file via CMAKE_TOOLCHAIN_FILE.")
    endif()
    # If found via find_package, set the toolchain file path (adjust if needed)
    # This path might vary depending on your Emscripten installation
    set(CMAKE_TOOLCHAIN_FILE ${EMSCRIPTEN_ROOT_PATH}/cmake/Modules/Platform/Emscripten.cmake CACHE PATH "Emscripten Toolchain File")
    message(STATUS "Found Emscripten Toolchain at: ${CMAKE_TOOLCHAIN_FILE}")
endif()

# --- Emscripten Specific Settings ---

# Set output directory for WASM/JS files
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/wasm_build)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/wasm_build)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/wasm_build)

# Enable Embind for C++/JS bindings
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -lembind")
# Enable optimization level 3
set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -O3")
# Recommended flags for WASM
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -s WASM=1")
# Allow memory growth if needed (adjust as necessary)
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -s ALLOW_MEMORY_GROWTH=1")
# Export the module (ES6 default)
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -s MODULARIZE=1 -s EXPORT_ES6=1 -s USE_ES6_IMPORT_META=0 -s EXPORTED_RUNTIME_METHODS=ccall,cwrap")

# Define the output JS file name (Emscripten uses target name by default)
set(EMSCRIPTEN_MODULE_NAME primekit)


# --- Project Sources ---

# Find all .cpp files in the src/cpp directory
file(GLOB CPP_SOURCES "src/cpp/*.cpp")

# --- Target Definition ---

# Create the executable target (Emscripten will produce .wasm and .js)
add_executable(${EMSCRIPTEN_MODULE_NAME} ${CPP_SOURCES})

# Link libraries if needed (e.g., -lm for math)
# target_link_libraries(${EMSCRIPTEN_MODULE_NAME} m)

# Set Emscripten linker flags specifically for the target
set_target_properties(${EMSCRIPTEN_MODULE_NAME} PROPERTIES
    LINK_FLAGS "-O3 -lembind -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s USE_ES6_IMPORT_META=0 -s EXPORTED_RUNTIME_METHODS=ccall,cwrap -s EXPORT_NAME=${EMSCRIPTEN_MODULE_NAME}Module -o ${CMAKE_BINARY_DIR}/wasm_build/${EMSCRIPTEN_MODULE_NAME}.js"
)

# --- Installation (Optional) ---
# You might want to configure installation rules if needed

message(STATUS "Project: ${PROJECT_NAME}")
message(STATUS "CXX Standard: ${CMAKE_CXX_STANDARD}")
message(STATUS "Sources: ${CPP_SOURCES}")
message(STATUS "Build Type: ${CMAKE_BUILD_TYPE}") # Empty if not set (e.g., via -DCMAKE_BUILD_TYPE=Release)
message(STATUS "Output WASM/JS: ${CMAKE_BINARY_DIR}/wasm_build/${EMSCRIPTEN_MODULE_NAME}.wasm / .js") 