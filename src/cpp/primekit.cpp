#include "primekit.h"
#include <emscripten/bind.h>
#include <iostream> // For potential debugging
#include <numeric>  // Not strictly needed for this impl, but useful potentially
#include <limits>   // For UINT64_MAX
#include <stdexcept> // For exceptions
#include "nlohmann/json.hpp" // Use standard include path managed by CMake
#include <cstdint> // For uint64_t
#include <cmath> // For std::pow

// Use the nlohmann json namespace
using json = nlohmann::json;

// --- PrimeKit Implementation ---

// Constructor is now simpler, prime maps loaded separately
PrimeKit::PrimeKit() {
    std::cout << "[WASM] PrimeKit constructed. Ready to load primes and inventory." << std::endl;
}

PrimeKit::~PrimeKit() {
    std::cout << "[WASM] PrimeKit destructed." << std::endl;
}

// New method to load primes from a JSON string
void PrimeKit::initializePrimesFromJson(const std::string& json_string) {
    std::cout << "[WASM] Parsing primes JSON... Got string length: " << json_string.length() << std::endl;
    attribute_prime_map.clear(); // Clear previous primes

    try {
        json primes_json = json::parse(json_string);
        std::cout << "[WASM] Parsed JSON successfully. Checking sections..." << std::endl;

        if (primes_json.contains("attribute_to_prime")) {
            std::cout << "[WASM] Found attribute_to_prime section." << std::endl;
            const auto& attributes = primes_json["attribute_to_prime"];
            if (attributes.is_object()) {
                std::cout << "[WASM] Iterating attributes..." << std::endl;
                for (auto const& [attr_key, attr_values] : attributes.items()) {
                    std::cout << "[WASM]   Attr Key: " << attr_key << std::endl;
                    if (attr_values.is_object()) {
                         std::cout << "[WASM]     Iterating values for " << attr_key << "..." << std::endl;
                        for (auto const& [val_key, prime_val] : attr_values.items()) {
                            if (prime_val.is_number_unsigned()) {
                                uint64_t prime = prime_val.get<uint64_t>();
                                std::cout << "[WASM]       Value Key: " << val_key << ", Raw Prime: " << prime << std::endl;
                                if (prime > 1) { // Basic prime check (ensure it's not 1)
                                    attribute_prime_map[attr_key][val_key] = prime;
                                     std::cout << "[WASM]         -> Stored Prime: " << prime << std::endl;
                                } else {
                                    std::cerr << "[WASM Warning] Prime value for [" << attr_key << "][" << val_key << "] is not > 1. Skipping." << std::endl;
                                }
                            } else {
                                std::cerr << "[WASM Warning] Prime value for [" << attr_key << "][" << val_key << "] is not an unsigned integer. Skipping." << std::endl;
                            }
                        }
                    } else {
                         std::cerr << "[WASM Warning] Value map for attribute '" << attr_key << "' is not an object. Skipping." << std::endl;
                    }
                }
            } else {
                 std::cerr << "[WASM Error] 'attribute_to_prime' section is not an object." << std::endl;
            }
        } else {
            std::cerr << "[WASM Error] Required section 'attribute_to_prime' not found in primes JSON." << std::endl;
            throw std::runtime_error("Invalid primes JSON format: missing 'attribute_to_prime' section.");
        }

        std::cout << "[WASM] Successfully parsed primes JSON. Attributes found: " << attribute_prime_map.size() << std::endl;

    } catch (json::parse_error& e) {
        std::cerr << "[WASM Error] Failed to parse primes JSON: " << e.what() << std::endl;
        throw std::runtime_error("Failed to parse primes JSON.");
    } catch (std::exception& e) {
        std::cerr << "[WASM Error] Error processing primes: " << e.what() << std::endl;
         throw std::runtime_error("Error processing primes.");
    }
}

// Helper to get prime, returns 1 (neutral element for multiplication) if not found
uint64_t PrimeKit::get_prime(const PrimeDictionary& dict, const std::string& key, const std::string& value) {
    auto key_it = dict.find(key);
    if (key_it != dict.end()) {
        auto value_it = key_it->second.find(value);
        if (value_it != key_it->second.end()) {
            // Basic check: ensure prime is actually greater than 1
            if (value_it->second > 1) {
                return value_it->second;
            }
        }
    }
    // Optional: Add warning/error logging here if a prime is missing
    // std::cerr << "Warning: Prime not found or invalid for key: " << key << ", value: " << value << std::endl;
    return 1; // Return 1 if attribute or value is not found or invalid
}

// Encodes SFI based on selected attributes and primes (handles multi-value)
uint64_t PrimeKit::encode_sfi(const ItemAttributes& attributes, const std::vector<std::string>& relevant_keys, const PrimeDictionary& prime_dict) {
    uint64_t sfi = 1;
    const uint64_t max_val = std::numeric_limits<uint64_t>::max();

    for (const std::string& key : relevant_keys) { // e.g., key = "color"
        auto attr_it = attributes.find(key);
        if (attr_it != attributes.end()) {
            // attr_it->second is now a std::vector<std::string>, e.g., ["Red", "Blue"]
            for (const std::string& value : attr_it->second) { // Iterate through values ("Red", then "Blue")
                uint64_t prime = get_prime(prime_dict, key, value); // Get prime for "Red", then prime for "Blue"

                if (prime > 1) {
                    // Check for potential overflow before multiplying
                    if (sfi > max_val / prime) {
                        std::cerr << "ERROR: SFI overflow detected during encoding! Key: " << key
                                  << ", Value: " << value << ", Prime: " << prime
                                  << ", Current SFI: " << sfi << std::endl;
                        return 1; // Indicate error/invalid SFI
                    }
                    sfi *= prime; // Multiply the prime into the SFI
                }
            } // End loop through values for this key
        }
        // else: Optional warning if key (e.g. "color") is missing entirely
    } // End loop through relevant keys
    return sfi;
}

// Processes a single item's raw data to calculate its SFIs
// Note: This method isn't directly exposed to JS in this version
std::tuple<uint64_t, uint64_t> PrimeKit::process_item_attributes(const ItemAttributes& item_attributes) {
    uint64_t master_sfi = encode_sfi(item_attributes, master_attribute_keys_, master_primes_);
    uint64_t local_sfi = encode_sfi(item_attributes, local_attribute_keys_, local_primes_);
    // If encoding failed (overflow), the SFI will be 1
    return std::make_tuple(master_sfi, local_sfi);
}

// Initializes from inventory JSON string
void PrimeKit::initializeFromJson(const std::string& json_string) {
    std::cout << "[WASM] Parsing inventory JSON..." << std::endl;
    internal_sku_data_.clear(); // Use correct member name

    try {
        json inventory_json = json::parse(json_string);
        if (!inventory_json.is_array()) {
            throw std::runtime_error("Inventory JSON is not an array.");
        }

        internal_sku_data_.reserve(inventory_json.size()); // Use correct member name

        for (const auto& item : inventory_json) {
            if (!item.is_object() || !item.contains("id") || !item.contains("attributes")) {
                std::cerr << "[WASM Warning] Skipping invalid inventory item format." << std::endl;
                continue;
            }

            SkuData sku;
            sku.id = item["id"].get<std::string>();
            sku.sfi = 1;

            const auto& attributes = item["attributes"];
            if (attributes.is_object()) {
                for (auto const& [attr_key, attr_values] : attributes.items()) {
                    // IMPORTANT: Skip 'brand' attribute for SFI calculation
                    if (attr_key == "brand") continue; 

                    if (!attribute_prime_map.count(attr_key)) {
                        // std::cout << "[WASM Note] Skipping attribute '" << attr_key << "' for SFI calculation (no prime map)." << std::endl;
                        continue; // Attribute type not in our prime map
                    }
                    const auto& prime_value_map = attribute_prime_map.at(attr_key);

                    if (attr_values.is_array()) {
                        for (const auto& val : attr_values) {
                            if (val.is_string()) {
                                std::string val_str = val.get<std::string>();
                                if (prime_value_map.count(val_str)) {
                                    uint64_t prime = prime_value_map.at(val_str);
                                    uint64_t current_sfi = sku.sfi;
                                    // Overflow check before multiplication
                                    if (prime > 0 && current_sfi > UINT64_MAX / prime) {
                                        std::cerr << "[WASM Warning] SFI overflow detected for SKU " << sku.id 
                                                  << " while multiplying by prime " << prime << " for attribute [" << attr_key << "][" << val_str << "]! SFI will be capped." << std::endl;
                                        sku.sfi = UINT64_MAX;
                                        goto next_item; // Skip rest of attrs for this item if overflow
                                    } else if (prime > 1) {
                                        sku.sfi *= prime;
                                    }
                                }
                                // else: Value not found in prime map for this attribute - ignored for SFI
                            }
                        }
                    }
                     // else: Attribute values not an array - ignored
                }
            } 
            // else: Attributes section not an object - ignored

            internal_sku_data_.push_back(sku); // Use correct member name
        next_item:;
        }

        std::cout << "[WASM] Initialized PrimeKit with " << internal_sku_data_.size() << " SKUs from JSON." << std::endl; // Use correct member name

    } catch (json::parse_error& e) {
        std::cerr << "[WASM Error] Failed to parse inventory JSON: " << e.what() << std::endl;
        throw std::runtime_error("Failed to parse inventory JSON.");
    } catch (std::exception& e) {
         std::cerr << "[WASM Error] Error processing inventory: " << e.what() << std::endl;
         throw std::runtime_error("Error processing inventory.");
    }
}

// Filters the loaded SKUs based on query SFIs
// Reverted to return vector<FilterResult>
std::vector<FilterResult> PrimeKit::perform_filter(uint64_t query_sfi) {
    std::cout << "[WASM] Filtering with Query SFI: " << query_sfi << std::endl;
    std::vector<FilterResult> matching_results;
    
    if (query_sfi == 0) { // Avoid division by zero
        std::cerr << "[WASM Error] Query SFI cannot be zero." << std::endl;
        return matching_results; // Return empty vector
    }
    if (query_sfi == 1) { // Optimization: If query is 1, all items match
        matching_results.reserve(internal_sku_data_.size()); // Use correct member name
        for (const auto& item : internal_sku_data_) { // Use correct member name
             matching_results.push_back({item.id, item.sfi});
        }
        std::cout << "[WASM] Query SFI is 1, returning all " << internal_sku_data_.size() << " SKUs." << std::endl; // Use correct member name
        return matching_results;
    }

    for (const auto& item : internal_sku_data_) { // Use correct member name
        if (item.sfi != 0 && item.sfi % query_sfi == 0) { // Check divisibility
             matching_results.push_back({item.id, item.sfi});
        }
    }

    std::cout << "[WASM] Found " << matching_results.size() << " matching SKUs." << std::endl;
    return matching_results;
}

// --- Embind Bindings ---

using namespace emscripten;

EMSCRIPTEN_BINDINGS(primekit_module) {
    
    // Ensure FilterResult struct is registered
    value_object<FilterResult>("FilterResult")
        .field("id", &FilterResult::id)
        .field("sfi", &FilterResult::sfi)
        ;

    // Ensure vector<FilterResult> is registered
    register_vector<FilterResult>("VectorFilterResult");
    
    // Keep VectorString registered (optional, no harm)
    register_vector<std::string>("VectorString");

    // Bind the PrimeKit class
    class_<PrimeKit>("PrimeKit")
        .constructor<>()
        .function("initializePrimesFromJson", &PrimeKit::initializePrimesFromJson)
        .function("initializeFromJson", &PrimeKit::initializeFromJson)
        .function("perform_filter", &PrimeKit::perform_filter)
        // Allow the instance to be deleted from JS, explicitly allowing raw pointer
        .function("delete", &PrimeKit::delete_, allow_raw_pointers());

} 