#ifndef PRIME_KIT_H
#define PRIME_KIT_H

#include <string>
#include <vector>
#include <map>
#include <cstdint>
#include <tuple>

// Represents the attribute-to-prime mapping
// For simplicity, hardcoding this for now instead of JSON loading
using PrimeDictionary = std::map<std::string, std::map<std::string, uint64_t>>;

// Represents a single product item's raw attributes
using ItemData = std::map<std::string, std::string>;

// Structure to hold processed SKU data including SFIs
struct SkuData {
    std::string sku_id;
    uint64_t master_sfi;
    uint64_t local_sfi;
    // Potentially add original attributes map if needed later

    // Required for Embind value object support
    SkuData() : master_sfi(1), local_sfi(1) {}
    SkuData(std::string id, uint64_t master, uint64_t local)
        : sku_id(std::move(id)), master_sfi(master), local_sfi(local) {}
};

// The core class for SFI encoding and filtering
class PrimeKit {
public:
    PrimeKit();

    // Encodes SFI based on selected attributes and primes
    uint64_t encode_sfi(const ItemData& attributes, const std::vector<std::string>& relevant_keys, const PrimeDictionary& prime_dict);

    // Processes a single item's raw data to calculate its SFIs
    std::tuple<uint64_t, uint64_t> process_item(const ItemData& item);

    // Initializes the internal SKU list from inventory data passed from JS
    // Expects a vector of SkuData structs directly (simplifies C++ side)
    void initialize_data(const std::vector<SkuData>& inventory_data);

    // Filters the loaded SKUs based on query SFIs
    std::vector<std::string> perform_filter(uint64_t master_query, uint64_t local_query);

private:
    // Hardcoded prime dictionaries (replace JSON loading for now)
    PrimeDictionary master_primes_;
    PrimeDictionary local_primes_; // Example: Using one local dict for simplicity
    // Define which attributes belong to master/local categories
    std::vector<std::string> master_attribute_keys_;
    std::vector<std::string> local_attribute_keys_;

    // Internal storage for processed SKU data
    std::vector<SkuData> internal_sku_data_;

    // Helper to get prime, returns 1 if not found
    uint64_t get_prime(const PrimeDictionary& dict, const std::string& key, const std::string& value);
};

#endif // PRIME_KIT_H 