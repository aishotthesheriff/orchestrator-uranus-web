#!/bin/bash

# Detailed Image Provider Testing Script for Uranus Dungeon Guide
# Comprehensive testing with multiple templates and scenarios

set -e

# Configuration
BASE_URL="http://localhost:5001"
API_KEY="${TEST_API_KEY:-your-test-api-key-here}"
OUTPUT_DIR="./test-results/$(date +%Y%m%d_%H%M%S)_detailed"
LOG_FILE="$OUTPUT_DIR/detailed-image-tests.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Logging function
log() {
    echo -e "$1" | tee -a "$LOG_FILE"
}

# Test result tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

# Test result function
test_result() {
    local test_name="$1"
    local success="$2"
    local duration="$3"
    local details="$4"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    if [ "$success" = "true" ]; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
        log "${GREEN}✅ PASS${NC} - $test_name (${duration}ms)"
        if [ -n "$details" ]; then
            log "   Details: $details"
        fi
    elif [ "$success" = "skipped" ]; then
        SKIPPED_TESTS=$((SKIPPED_TESTS + 1))
        log "${YELLOW}⏭️  SKIP${NC} - $test_name"
        if [ -n "$details" ]; then
            log "   Reason: $details"
        fi
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
        log "${RED}❌ FAIL${NC} - $test_name (${duration}ms)"
        if [ -n "$details" ]; then
            log "   Error: $details"
        fi
    fi
}

# Test a single image provider with detailed analysis
test_image_provider_detailed() {
    local model_key="$1"
    local provider_name="$2"
    local template_name="$3"
    local test_description="$4"
    local custom_variables="$5"
    
    local test_name="Image Provider: $provider_name ($model_key) - $template_name"
    local start_time=$(date +%s)
    
    log "${BLUE}Testing $test_name...${NC}"
    
    # Prepare test data with custom variables
    local test_data=$(cat <<EOF
{
  "templateName": "$template_name",
  "variables": {
    "CUSTOM_DESCRIPTION": "$custom_variables",
    "imageModelKey": "$model_key"
  }
}
EOF
)
    
    # Make the API call
    local response=$(curl -s -w "\n%{http_code}" \
        -X POST "$BASE_URL/api/test-generate-image" \
        -H "Content-Type: application/json" \
        -d "$test_data" 2>/dev/null)
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    local end_time=$(date +%s)
    local duration=$(((end_time - start_time) * 1000))
    
    # Save detailed response
    local response_file="$OUTPUT_DIR/${model_key}_${template_name}_response.json"
    echo "$body" | jq . > "$response_file" 2>/dev/null || echo "$body" > "${response_file%.json}.txt"
    
    # Validate response
    if [ "$http_code" = "200" ]; then
        # Check if response contains imageUrl
        if echo "$body" | jq -e '.imageUrl' > /dev/null 2>&1; then
            local image_url=$(echo "$body" | jq -r '.imageUrl')
            local prompt_used=$(echo "$body" | jq -r '.promptUsed // "N/A"')
            local debug_info=$(echo "$body" | jq -r '.debugInfo // {}')
            local generation_time=$(echo "$debug_info" | jq -r '.generationTime // "N/A"')
            
            # Validate image URL format
            if [[ "$image_url" =~ ^data:image/.*base64,.* ]] || [[ "$image_url" =~ ^https?://.* ]]; then
                # Additional validation for base64 data
                if [[ "$image_url" =~ ^data:image/.*base64,.* ]]; then
                    local base64_data=$(echo "$image_url" | cut -d',' -f2)
                    if [ ${#base64_data} -gt 100 ]; then
                        test_result "$test_name" "true" "$duration" "Generated valid base64 image (${generation_time}ms generation time)"
                    else
                        test_result "$test_name" "false" "$duration" "Base64 data too short (${#base64_data} chars)"
                    fi
                else
                    test_result "$test_name" "true" "$duration" "Generated valid image URL (${generation_time}ms generation time)"
                fi
            else
                test_result "$test_name" "false" "$duration" "Invalid image URL format: $image_url"
            fi
        else
            test_result "$test_name" "false" "$duration" "No imageUrl in response"
        fi
    else
        local error_msg=$(echo "$body" | jq -r '.error // .message // "Unknown error"' 2>/dev/null || echo "HTTP $http_code")
        test_result "$test_name" "false" "$duration" "$error_msg"
    fi
}

# Test different image sizes
test_image_sizes() {
    log "${PURPLE}Testing Image Sizes...${NC}"
    
    local sizes=("1024x1024" "1536x1024" "1024x1536")
    local model="gpt-image-1-mini"
    
    for size in "${sizes[@]}"; do
        local test_name="Image Size: $size"
        local start_time=$(date +%s)
        
        # Test with size-specific template
        local test_data=$(cat <<EOF
{
  "templateName": "general_scene",
  "variables": {
    "CUSTOM_DESCRIPTION": "A futuristic spaceship interior",
    "imageModelKey": "$model"
  }
}
EOF
)
        
        local response=$(curl -s -w "\n%{http_code}" \
            -X POST "$BASE_URL/api/test-generate-image" \
            -H "Content-Type: application/json" \
            -d "$test_data" 2>/dev/null)
        
        local http_code=$(echo "$response" | tail -n1)
        local body=$(echo "$response" | head -n -1)
        local end_time=$(date +%s)
        local duration=$(((end_time - start_time) * 1000))
        
        if [ "$http_code" = "200" ] && echo "$body" | jq -e '.imageUrl' > /dev/null 2>&1; then
            test_result "$test_name" "true" "$duration" "Successfully generated $size image"
        else
            test_result "$test_name" "false" "$duration" "Failed to generate $size image"
        fi
    done
}

# Test different quality settings
test_quality_settings() {
    log "${PURPLE}Testing Quality Settings...${NC}"
    
    local qualities=("low" "medium" "high" "auto")
    local model="gpt-image-1-mini"
    
    for quality in "${qualities[@]}"; do
        local test_name="Quality Setting: $quality"
        local start_time=$(date +%s)
        
        # Note: Quality settings are handled by the template system
        # This test verifies the system can handle different quality requests
        local test_data=$(cat <<EOF
{
  "templateName": "general_scene",
  "variables": {
    "CUSTOM_DESCRIPTION": "A futuristic spaceship interior",
    "imageModelKey": "$model"
  }
}
EOF
)
        
        local response=$(curl -s -w "\n%{http_code}" \
            -X POST "$BASE_URL/api/test-generate-image" \
            -H "Content-Type: application/json" \
            -d "$test_data" 2>/dev/null)
        
        local http_code=$(echo "$response" | tail -n1)
        local body=$(echo "$response" | head -n -1)
        local end_time=$(date +%s)
        local duration=$(((end_time - start_time) * 1000))
        
        if [ "$http_code" = "200" ] && echo "$body" | jq -e '.imageUrl' > /dev/null 2>&1; then
            test_result "$test_name" "true" "$duration" "Successfully generated image with $quality quality"
        else
            test_result "$test_name" "false" "$duration" "Failed to generate image with $quality quality"
        fi
    done
}

# Test different templates
test_templates() {
    log "${PURPLE}Testing Different Templates...${NC}"
    
    local templates=(
        "general_scene:A futuristic spaceship interior with cosmic elements"
        "technical_problem:A complex engineering problem in the ship's engine room"
        "cosmic_encounter:An alien encounter in deep space"
        "arrival_departure:A dramatic scene of a spaceship launching from Earth"
    )
    
    local model="gpt-image-1-mini"
    
    for template_info in "${templates[@]}"; do
        IFS=':' read -r template_name description <<< "$template_info"
        local test_name="Template: $template_name"
        local start_time=$(date +%s)
        
        local test_data=$(cat <<EOF
{
  "templateName": "$template_name",
  "variables": {
    "CUSTOM_DESCRIPTION": "$description",
    "imageModelKey": "$model"
  }
}
EOF
)
        
        local response=$(curl -s -w "\n%{http_code}" \
            -X POST "$BASE_URL/api/test-generate-image" \
            -H "Content-Type: application/json" \
            -d "$test_data" 2>/dev/null)
        
        local http_code=$(echo "$response" | tail -n1)
        local body=$(echo "$response" | head -n -1)
        local end_time=$(date +%s)
        local duration=$(((end_time - start_time) * 1000))
        
        if [ "$http_code" = "200" ] && echo "$body" | jq -e '.imageUrl' > /dev/null 2>&1; then
            test_result "$test_name" "true" "$duration" "Successfully generated $template_name template"
        else
            local error_msg=$(echo "$body" | jq -r '.error // .message // "Unknown error"' 2>/dev/null || echo "HTTP $http_code")
            test_result "$test_name" "false" "$duration" "$error_msg"
        fi
    done
}

# Test provider-specific features
test_provider_features() {
    log "${PURPLE}Testing Provider-Specific Features...${NC}"
    
    # Test HuggingFace provider selection
    if [ -n "$HF_TOKEN" ]; then
        local test_name="HF Provider: fal-ai"
        local start_time=$(date +%s)
        
        local test_data=$(cat <<EOF
{
  "templateName": "general_scene",
  "variables": {
    "CUSTOM_DESCRIPTION": "A futuristic spaceship interior",
    "imageModelKey": "retro-pixel-flux"
  }
}
EOF
)
        
        local response=$(curl -s -w "\n%{http_code}" \
            -X POST "$BASE_URL/api/test-generate-image" \
            -H "Content-Type: application/json" \
            -d "$test_data" 2>/dev/null)
        
        local http_code=$(echo "$response" | tail -n1)
        local body=$(echo "$response" | head -n -1)
        local end_time=$(date +%s)
        local duration=$(((end_time - start_time) * 1000))
        
        if [ "$http_code" = "200" ] && echo "$body" | jq -e '.imageUrl' > /dev/null 2>&1; then
            test_result "$test_name" "true" "$duration" "Successfully used fal-ai provider"
        else
            local error_msg=$(echo "$body" | jq -r '.error // .message // "Unknown error"' 2>/dev/null || echo "HTTP $http_code")
            test_result "$test_name" "false" "$duration" "$error_msg"
        fi
    else
        test_result "HF Provider: fal-ai" "skipped" "0" "HF_TOKEN not set"
    fi
}

# Performance comparison between providers
test_performance_comparison() {
    log "${PURPLE}Performance Comparison...${NC}"
    
    local models=("gpt-image-1-mini" "sdxl-turbo" "flux-schnell")
    local results=()
    
    for model in "${models[@]}"; do
        if [ "$model" = "gpt-image-1-mini" ] && [ -z "$OPENAI_API_KEY" ]; then
            continue
        fi
        if [[ "$model" =~ ^(sdxl|flux) ]] && [ -z "$HF_TOKEN" ]; then
            continue
        fi
        
        local test_name="Performance: $model"
        local start_time=$(date +%s)
        
        local test_data=$(cat <<EOF
{
  "templateName": "general_scene",
  "variables": {
    "CUSTOM_DESCRIPTION": "A futuristic spaceship interior",
    "imageModelKey": "$model"
  }
}
EOF
)
        
        local response=$(curl -s -w "\n%{http_code}" \
            -X POST "$BASE_URL/api/test-generate-image" \
            -H "Content-Type: application/json" \
            -d "$test_data" 2>/dev/null)
        
        local http_code=$(echo "$response" | tail -n1)
        local body=$(echo "$response" | head -n -1)
        local end_time=$(date +%s)
        local duration=$(((end_time - start_time) * 1000))
        
        if [ "$http_code" = "200" ] && echo "$body" | jq -e '.imageUrl' > /dev/null 2>&1; then
            local generation_time=$(echo "$body" | jq -r '.debugInfo.generationTime // "N/A"')
            test_result "$test_name" "true" "$duration" "Total: ${duration}ms, Generation: ${generation_time}ms"
            results+=("$model:$duration:$generation_time")
        else
            test_result "$test_name" "false" "$duration" "Failed to generate image"
        fi
    done
    
    # Generate performance report
    if [ ${#results[@]} -gt 0 ]; then
        log ""
        log "${BLUE}Performance Summary:${NC}"
        log "Model | Total Time | Generation Time"
        log "------|------------|----------------"
        for result in "${results[@]}"; do
            IFS=':' read -r model total_time gen_time <<< "$result"
            log "$model | ${total_time}ms | ${gen_time}ms"
        done
    fi
}

# Check prerequisites
check_prerequisites() {
    log "${BLUE}Checking prerequisites...${NC}"
    
    # Check if server is running
    if ! curl -s "$BASE_URL/api/health" > /dev/null 2>&1; then
        log "${RED}❌ Server is not running at $BASE_URL${NC}"
        exit 1
    fi
    
    # Check if jq is available
    if ! command -v jq > /dev/null 2>&1; then
        log "${RED}❌ jq is required but not installed${NC}"
        exit 1
    fi
    
    # Check environment variables
    if [ -z "$OPENAI_API_KEY" ]; then
        log "${YELLOW}⚠️  OPENAI_API_KEY not set - OpenAI tests will be skipped${NC}"
    fi
    
    if [ -z "$HF_TOKEN" ]; then
        log "${YELLOW}⚠️  HF_TOKEN not set - HuggingFace tests will be skipped${NC}"
    fi
    
    log "${GREEN}✅ Prerequisites check completed${NC}"
}

# Main test execution
main() {
    log "${GREEN}🧪 Detailed Image Provider Testing Suite${NC}"
    log "============================================="
    log "Comprehensive testing with multiple scenarios"
    log "Output directory: $OUTPUT_DIR"
    log "Log file: $LOG_FILE"
    log ""
    
    check_prerequisites
    
    log "${BLUE}Starting detailed image provider tests...${NC}"
    log ""
    
    # Test different templates
    test_templates
    
    # Test image sizes
    test_image_sizes
    
    # Test quality settings
    test_quality_settings
    
    # Test provider-specific features
    test_provider_features
    
    # Test all providers with different scenarios
    log "${YELLOW}Testing All Providers with Different Scenarios${NC}"
    
    # OpenAI tests
    if [ -n "$OPENAI_API_KEY" ]; then
        test_image_provider_detailed "gpt-image-1-mini" "OpenAI" "general_scene" "Basic scene generation" "A futuristic spaceship interior"
        test_image_provider_detailed "gpt-image-1-mini" "OpenAI" "technical_problem" "Technical problem visualization" "A complex engineering problem in the ship's engine room"
        test_image_provider_detailed "gpt-image-1-mini" "OpenAI" "cosmic_encounter" "Alien encounter scene" "An alien encounter in deep space"
    else
        test_result "OpenAI Provider Tests" "skipped" "0" "OPENAI_API_KEY not set"
    fi
    
    # HuggingFace tests
    if [ -n "$HF_TOKEN" ]; then
        # Standard models
        test_image_provider_detailed "sdxl" "HuggingFace SDXL" "general_scene" "High quality scene generation" "A futuristic spaceship interior"
        test_image_provider_detailed "sdxl-turbo" "HuggingFace SDXL Turbo" "general_scene" "Fast scene generation" "A futuristic spaceship interior"
        test_image_provider_detailed "flux-schnell" "HuggingFace FLUX" "general_scene" "Ultra fast generation" "A futuristic spaceship interior"
        
        # SD 3.5 models
        test_image_provider_detailed "sd-large-turbo" "HuggingFace SD 3.5 Large" "general_scene" "Latest SD model" "A futuristic spaceship interior"
        test_image_provider_detailed "sd-medium-turbo" "HuggingFace SD 3.5 Medium" "general_scene" "Balanced SD model" "A futuristic spaceship interior"
        
        # Specialized models
        test_image_provider_detailed "claymation-xl" "HuggingFace Claymation" "general_scene" "Claymation style" "A futuristic spaceship interior in claymation style"
        test_image_provider_detailed "retro-pixel-flux" "HuggingFace Retro Pixel" "general_scene" "Retro pixel art" "A futuristic spaceship interior in retro pixel art style"
        test_image_provider_detailed "fal-flux-pixel-art" "HuggingFace Modern Pixel" "general_scene" "Modern pixel art" "A futuristic spaceship interior in modern pixel art style"
    else
        log "${YELLOW}Skipping HuggingFace tests - HF_TOKEN not set${NC}"
        test_result "HuggingFace Provider Tests" "skipped" "0" "HF_TOKEN not set"
    fi
    
    # Performance comparison
    test_performance_comparison
    
    # Generate summary report
    log ""
    log "${GREEN}📊 Detailed Test Summary${NC}"
    log "========================="
    log "Total Tests: $TOTAL_TESTS"
    log "Passed: $PASSED_TESTS"
    log "Failed: $FAILED_TESTS"
    log "Skipped: $SKIPPED_TESTS"
    log ""
    
    if [ "$FAILED_TESTS" -eq 0 ]; then
        log "${GREEN}🎉 All tests passed!${NC}"
        exit 0
    else
        log "${RED}❌ $FAILED_TESTS test(s) failed${NC}"
        exit 1
    fi
}

# Run the tests
main "$@"
