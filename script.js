(function() {
  "use strict";

  // --- Configuration URLs ---
  const BUILD_DATA_URL = "data/characters.json";
  const RELIC_INFO_URL = "data/relics.json";

  // --- DOM Elements ---
  const appContent = document.getElementById("app-content");
  const searchPopup = document.getElementById("search-popup");
  const universalSearchInput = document.getElementById("universal-search-input");
  const universalSearchResults = document.getElementById("universal-search-results");
  const universalSearchClearBtn = document.getElementById("universal-search-clear-btn");
  const navSearchButton = document.getElementById("nav-search-button");
  const mainNav = document.getElementById("main-nav");

  // --- Static Data ---
  const siteTitle = "Honkai: Star Rail Relic Helper";

  // --- Dynamic Data (populated during initialization) ---
  let RELIC_SETS_DATA = []; // Cavern Relics, sorted by ID desc
  let ORNAMENT_SETS_DATA = []; // Planar Ornaments, sorted by ID desc
  let ALL_KNOWN_SETS_SORTED = []; // All set names, sorted by string length desc (for parsing efficiency)
  let relicSetDetailsData = []; // Raw relic info from relics.json
  let characterBuilds = []; // Processed character build data, sorted
  let allCharacters = []; // Character names, derived from sorted characterBuilds

  // Precomputed maps for faster lookups, populated in initApp
  let ALL_KNOWN_SETS_SLUG_MAP = new Map(); // Map<slug, originalSetName>
  let ALL_KNOWN_SETS_NORMALIZED_MAP = new Map(); // Map<normalizedName, originalSetName> (lowercase, no special chars)

  // --- Static Schemas & Aliases ---
  const MAIN_STATS_SCHEMA = {
    HEAD: ["HP"],
    HANDS: ["ATK"],
    BODY: [
      "HP%", "DEF%", "ATK%", "CRIT Rate", "CRIT DMG",
      "Effect HIT Rate", "Outgoing Healing",
    ],
    FEET: ["HP%", "DEF%", "ATK%", "Speed"],
    SPHERE: [
      "HP%", "DEF%", "ATK%", "Physical DMG", "Fire DMG", "Ice DMG",
      "Wind DMG", "Lightning DMG", "Quantum DMG", "Imaginary DMG",
    ],
    ROPE: ["HP%", "DEF%", "ATK%", "Break Effect", "Energy Regen Rate"],
  };

  const SUBSTATS_CANONICAL = [
    "HP", "DEF", "ATK", "HP%", "DEF%", "ATK%", "Speed", "CRIT Rate",
    "CRIT DMG", "Break Effect", "Effect Hit Rate", "Effect RES",
  ];
  // Precompute for parseSubstats efficiency: sorted by length for greedy matching
  const SORTED_SUBSTATS_CANONICAL_BY_LENGTH = [...SUBSTATS_CANONICAL].sort(
    (a, b) => b.length - a.length,
  );
  const SUBSTATS_CANONICAL_LOWER = SUBSTATS_CANONICAL.map((s) =>
    s.toLowerCase(),
  );

  const SUBSTAT_ALIASES = { // Keys are lowercase for consistent matching
    hp: "HP%",
    def: "DEF%",
    atk: "ATK%",
    ehr: "Effect Hit Rate",
    "ehr%": "Effect Hit Rate",
    "eff res": "Effect RES",
    "eff res%": "Effect RES",
    spd: "Speed",
    "crit rate": "CRIT Rate",
    "crit dmg": "CRIT DMG",
    "break effect%": "Break Effect",
  };

  // --- Search State ---
  let searchableListItems = [];
  let currentSearchFocusIndex = -1;
  let lastUniversalSearchQueryValue = ""; // Remembers search query for current session

  // --- Filter Persistence State ---
  let previousPageInfo = {
    type: null, // e.g., 'relicSet', 'characterPage', 'home'
    slug: null, // e.g., 'genius-of-brilliant-stars'
    filters: null // { selectedMainStats, selectedSubStats, substatLogic } for relicSet pages
  };

  // --- Utility Functions ---
  function slugify(text) {
    if (!text) return "";
    return text.toString().toLowerCase()
      .replace(/\s+/g, "-") // Replace spaces with -
      .replace(/[^\w-]+/g, "") // Remove all non-word chars
      .replace(/--+/g, "-"); // Replace multiple - with single -
  }

  function deslugify(slug) {
    if (!slug) return "";
    return slug.replace(/-/g, " ")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Finds the original set name from a slug, trying various matching strategies.
   * Uses precomputed maps for efficiency.
   */
  function findOriginalSetName(slug) {
    if (!slug) return "";
    if (ALL_KNOWN_SETS_SLUG_MAP.has(slug)) {
      return ALL_KNOWN_SETS_SLUG_MAP.get(slug);
    }
    // Try matching against a normalized version (all lowercase, no hyphens)
    const normalizedSlug = slug.toLowerCase().replace(/-/g, "");
    if (ALL_KNOWN_SETS_NORMALIZED_MAP.has(normalizedSlug)) {
      return ALL_KNOWN_SETS_NORMALIZED_MAP.get(normalizedSlug);
    }
    // Fallback: deslugify and re-slugify to check if it matches a known slug
    const potentialName = deslugify(slug);
    if (ALL_KNOWN_SETS_SLUG_MAP.has(slugify(potentialName))) {
      return potentialName;
    }
    // If no match, return the deslugified version as a best guess
    return potentialName;
  }

  function getCharacterPieceStats(character, pieceType) {
    if (!character || !pieceType) return [];
    const pTypeLower = pieceType.toLowerCase();
    // Handle specific property names for sphere and rope
    if (pTypeLower === "sphere") return character.planarSphere || [];
    if (pTypeLower === "rope") return character.linkRope || [];
    // For other pieces, property name matches pieceType (e.g., character.body)
    return character[pTypeLower] || [];
  }

  // --- Data Parsing Functions ---

  /**
   * Parses a string containing comma-separated set names or concatenated set names.
   * Uses a greedy matching approach based on ALL_KNOWN_SETS_SORTED (longest names first).
   */
  function parseSetListString(setString) {
    if (!setString || typeof setString !== "string") return [];
    const foundSets = [];
    let remainingString = setString.trim();

    while (remainingString.length > 0) {
      let matched = false;
      for (const setName of ALL_KNOWN_SETS_SORTED) {
        if (remainingString.startsWith(setName)) {
          foundSets.push(setName);
          remainingString = remainingString.substring(setName.length).trim();
          if (remainingString.startsWith(",")) {
            remainingString = remainingString.substring(1).trim();
          }
          matched = true;
          break; // Found the longest possible match for this part of the string
        }
      }
      if (!matched) break; // No known set name matches the start of the remaining string
    }
    return foundSets;
  }

  /**
   * Parses a substat string into a list of canonical substat names and the original comment.
   * Handles various delimiters and aliases.
   */
  function parseSubstats(substatStr) {
    if (!substatStr) return {
      clean: [],
      comment: ""
    };

    const originalComment = substatStr; // Preserve the original string for display
    // Remove content within parentheses or brackets (e.g., notes, conditions) before parsing
    let tempStr = substatStr.replace(/\([^)]*\)|\[[^\]]*\]/g, "").trim();
    const parts = tempStr.split(/[>≥=]+/); // Split by common priority delimiters
    const cleanSubstats = [];
    const seenSubstats = new Set(); // To avoid duplicates

    for (const part of parts) {
      let potentialStat = part.trim().toLowerCase();
      if (!potentialStat) continue;

      let matchedCanonicalStat = null;

      // Priority 1: Exact alias match
      if (SUBSTAT_ALIASES[potentialStat]) {
        matchedCanonicalStat = SUBSTAT_ALIASES[potentialStat];
      } else {
        // Priority 2: Exact canonical stat match (case-insensitive)
        const canonicalIndex = SUBSTATS_CANONICAL_LOWER.indexOf(potentialStat);
        if (canonicalIndex !== -1) {
          matchedCanonicalStat = SUBSTATS_CANONICAL[canonicalIndex];
        }
      }

      // Priority 3 & 4: Partial matches (if no exact match found)
      if (!matchedCanonicalStat) {
        // Partial match against canonical stats (longest first for accuracy)
        for (const canonical of SORTED_SUBSTATS_CANONICAL_BY_LENGTH) {
          if (potentialStat.includes(canonical.toLowerCase())) {
            matchedCanonicalStat = canonical;
            break;
          }
        }
        // If still no match, try partial match against aliases
        if (!matchedCanonicalStat) {
          for (const alias in SUBSTAT_ALIASES) {
            if (potentialStat.includes(alias)) {
              matchedCanonicalStat = SUBSTAT_ALIASES[alias];
              break;
            }
          }
        }
      }

      if (matchedCanonicalStat && !seenSubstats.has(matchedCanonicalStat)) {
        cleanSubstats.push(matchedCanonicalStat);
        seenSubstats.add(matchedCanonicalStat);
      }
    }
    return {
      clean: cleanSubstats,
      comment: originalComment
    };
  }

  /**
   * Aggregates set names from multiple numbered properties (e.g., Relic1, Relic2...).
   */
  function aggregateAllSets(item, basePropName, numSlots = 5) {
    const allSets = new Set();
    for (let i = 1; i <= numSlots; i++) {
      const slotKey = `${basePropName}${i}`;
      if (item[slotKey]) {
        parseSetListString(item[slotKey]).forEach(set => allSets.add(set));
      }
    }
    return Array.from(allSets);
  }

  /**
   * Processes the raw character build data from JSON into a structured format.
   */
  function processData(jsonData) {
    characterBuilds = jsonData.map((item) => {
      const substatsParsed = parseSubstats(item.Substats);

      // Aggregate relic and planetary sets as "Concat" fields are no longer used from source
      const allRelicSets = aggregateAllSets(item, "Relic");
      const allPlanetarySets = aggregateAllSets(item, "Planetary");

      return {
        name: item.Name,
        ID: item.ID,
        Release: item.Release,
        body: item.Body ? item.Body.split(",").map((s) => s.trim()) : [],
        feet: item.Feet ? item.Feet.split(",").map((s) => s.trim()) : [],
        relicSetsAll: allRelicSets, // All unique relic sets mentioned for the character
        planetarySetsAll: allPlanetarySets, // All unique ornament sets
        // Individual relic/planetary options (up to 5)
        relic1: parseSetListString(item.Relic1),
        relic2: parseSetListString(item.Relic2),
        relic3: parseSetListString(item.Relic3),
        relic4: parseSetListString(item.Relic4),
        relic5: parseSetListString(item.Relic5),
        planarSphere: item["Planar Sphere"] ?
          item["Planar Sphere"].split(",").map((s) => s.trim()) : [],
        linkRope: item["Link Rope"] ?
          item["Link Rope"].split(",").map((s) => s.trim()) : [],
        planetary1: parseSetListString(item.Planetary1),
        planetary2: parseSetListString(item.Planetary2),
        planetary3: parseSetListString(item.Planetary3),
        planetary4: parseSetListString(item.Planetary4),
        planetary5: parseSetListString(item.Planetary5),
        substatsClean: substatsParsed.clean, // Parsed, canonical substat names
        substatsComment: substatsParsed.comment, // Original substat string with notes
      };
    });
  }

  // --- Rendering Functions ---

  /**
   * Generic helper to render a list of items (characters, relics, ornaments).
   */
  function _renderItemsList(items, itemType, listTitle, itemClass = "") {
    let listHtml = "";
    if (items.length > 0) {
      listHtml = items.map((name) => {
        const slug = slugify(name);
        let href = "",
          imgSrc = "";

        // Determine href and image source based on item type
        if (itemType === "cavern-relic") {
          href = `#/relics/${slug}`;
          imgSrc = `images/relic/${slug}.webp`;
        } else if (itemType === "planar-ornament") {
          href = `#/ornaments/${slug}`;
          imgSrc = `images/relic/${slug}.webp`; // Ornaments use relic image path
        } else if (itemType === "character") {
          href = `#/characters/${slug}`;
          imgSrc = `images/character/${slug}.webp`;
        }

        return `
            <li>
                <a href="${href}" title="${name}">
                    <img src="${imgSrc}" alt="" class="item-icon ${itemClass}" loading="lazy">
                    <span>${name}</span>
                </a>
            </li>`;
      }).join("");
    } else {
      listHtml = `<li class="no-results-in-list">No ${listTitle.toLowerCase()} found.</li>`;
    }
    return `<ul class="content-list item-grid-list">${listHtml}</ul>`;
  }

  function renderHomePage() {
    document.title = siteTitle;
    appContent.innerHTML = `
      <div class="page-container home-page-layout">
          <section class="home-section">
              <div class="page-header"><h2>Cavern Relics</h2></div>
              <div class="item-list-scroll-container">
                  ${_renderItemsList(RELIC_SETS_DATA, "cavern-relic", "Cavern Relics", "relic-list-icon")}
              </div>
          </section>
          <section class="home-section">
              <div class="page-header"><h2>Planar Ornaments</h2></div>
              <div class="item-list-scroll-container">
                  ${_renderItemsList(ORNAMENT_SETS_DATA, "planar-ornament", "Planar Ornaments", "relic-list-icon")}
              </div>
          </section>
          <section class="home-section">
              <div class="page-header"><h2>Characters</h2></div>
              <div class="item-list-scroll-container character-list">
                  ${_renderItemsList(allCharacters, "character", "Characters", "character-list-icon")}
              </div>
          </section>
      </div>`;
    previousPageInfo = {
      type: 'home',
      slug: null,
      filters: null
    };
  }

  function renderCavernRelicsPage() {
    document.title = `Cavern Relics - ${siteTitle}`;
    appContent.innerHTML = `
      <div class="page-container">
          <div class="page-header"><h2>Cavern Relics</h2></div>
          <div class="item-list-scroll-container full-page-list">
              ${_renderItemsList(RELIC_SETS_DATA, "cavern-relic", "Cavern Relics", "relic-list-icon")}
          </div>
      </div>`;
    previousPageInfo = {
      type: 'relicList',
      slug: null,
      filters: null
    };
  }

  function renderPlanarOrnamentsPage() {
    document.title = `Planar Ornaments - ${siteTitle}`;
    appContent.innerHTML = `
      <div class="page-container">
           <div class="page-header"><h2>Planar Ornaments</h2></div>
          <div class="item-list-scroll-container full-page-list">
              ${_renderItemsList(ORNAMENT_SETS_DATA, "planar-ornament", "Planar Ornaments", "relic-list-icon")}
          </div>
      </div>`;
    previousPageInfo = {
      type: 'ornamentList',
      slug: null,
      filters: null
    };
  }

  function renderCharactersListPage() {
    document.title = `Characters - ${siteTitle}`;
    appContent.innerHTML = `
      <div class="page-container">
          <div class="page-header"><h2>Characters</h2></div>
          <div class="item-list-scroll-container full-page-list character-list">
              ${_renderItemsList(allCharacters, "character", "Characters", "character-list-icon")}
          </div>
      </div>`;
    previousPageInfo = {
      type: 'characterList',
      slug: null,
      filters: null
    };
  }

  function renderCharacterPage(characterName) {
    const character = characterBuilds.find((c) => c.name === characterName);
    if (!character) {
      document.title = `Not Found - ${siteTitle}`;
      appContent.innerHTML = `<div class="page-container"><p>Character not found: ${characterName}</p><p><a href="#">Go Home</a></p></div>`;
      previousPageInfo = {
        type: 'error',
        slug: characterName,
        filters: null
      };
      return;
    }
    document.title = `${character.name} - ${siteTitle}`;

    const formatSetList = (sets) => {
      if (!sets || sets.length === 0) return "N/A";
      return sets.map((s) => {
        const isOrnament = ORNAMENT_SETS_DATA.includes(s);
        const slug = slugify(s);
        const href = isOrnament ? `#/ornaments/${slug}` : `#/relics/${slug}`;
        return `
            <span class="set-name-link">
                <a href="${href}">
                    <img src="images/relic/${slug}.webp" alt="" class="item-icon inline-icon" loading="lazy">
                    <span class="set-name-text">${s}</span>
                </a>
            </span>`;
      }).join("");
    };

    const relicRecommendations = [
      character.relic1, character.relic2, character.relic3,
      character.relic4, character.relic5,
    ].filter((r) => r && r.length > 0);

    const ornamentRecommendations = [
      character.planetary1, character.planetary2, character.planetary3,
      character.planetary4, character.planetary5,
    ].filter((p) => p && p.length > 0);

    appContent.innerHTML = `
      <div class="page-container">
          <div class="page-header">
              <div class="page-title-with-icon">
                  <img src="images/character-sticker/${slugify(character.name)}.webp" alt="${character.name}" class="page-main-icon" loading="lazy">
                  <h2>${character.name}</h2>
              </div>
          </div>
          <div class="build-section">
              <h3>Cavern Relics</h3>
              <div class="build-grid build-relics">
                  ${relicRecommendations.length > 0
                    ? relicRecommendations.map((relicSetOption, index) => {
                        // Check if it's a 2+2 piece combination from Cavern Relics
                        const isTwoPlusTwo = relicSetOption.length === 2 &&
                                           relicSetOption.every(setName => RELIC_SETS_DATA.includes(setName));
                        const optionTitle = `Option ${index + 1}${isTwoPlusTwo ? " (2 pcs + 2 pcs)" : ""}`;
                        return `
                          <div class="stat-group">
                              <h4>${optionTitle}</h4>
                              <p class="relic-option-list">${formatSetList(relicSetOption)}</p>
                          </div>`;
                      }).join("")
                    : "<p>No specific relic set recommendations found.</p>"
                  }
              </div>
          </div>
          <div class="build-section">
              <h3>Planar Ornaments</h3>
               <div class="build-grid build-planer-ornaments">
                  ${ornamentRecommendations.length > 0
                    ? ornamentRecommendations.map((ornamentSet, index) => `
                          <div class="stat-group">
                              <h4>Option ${index + 1}</h4>
                              <p class="relic-option-list">${formatSetList(ornamentSet)}</p>
                          </div>`).join("")
                    : "<p>No specific ornament set recommendations found.</p>"
                  }
              </div>
          </div>
          <div class="build-section">
              <h3>Main Stats Priority</h3>
              <div class="build-grid build-main-stats">
                  <div class="stat-group"><h4>Body</h4><ul><li>${character.body.join(" / ") || "N/A"}</li></ul></div>
                  <div class="stat-group"><h4>Feet</h4><ul><li>${character.feet.join(" / ") || "N/A"}</li></ul></div>
                  <div class="stat-group"><h4>Planar Sphere</h4><ul><li>${character.planarSphere.join(" / ") || "N/A"}</li></ul></div>
                  <div class="stat-group"><h4>Link Rope</h4><ul><li>${character.linkRope.join(" / ") || "N/A"}</li></ul></div>
              </div>
          </div>
          <div class="build-section">
              <h3>Substats Priority</h3>
              <div class="stat-group">
                  <ul>
                      ${character.substatsClean.map((s) => `<li>${s}</li>`).join("") || "<li>No specific substat priorities listed.</li>"}
                  </ul>
                  ${character.substatsComment ? `<div class="substat-comment"><strong>Note:</strong> ${character.substatsComment}</div>` : ""}
              </div>
          </div>
      </div>`;
    previousPageInfo = {
      type: 'characterPage',
      slug: slugify(character.name),
      filters: null
    };
  }

  function renderRelicSetPage(setSlug) {
    const setName = findOriginalSetName(setSlug);
    const isActualOrnament = ORNAMENT_SETS_DATA.includes(setName);
    const isActualRelic = RELIC_SETS_DATA.includes(setName);

    if (!isActualOrnament && !isActualRelic) {
      document.title = `Not Found - ${siteTitle}`;
      appContent.innerHTML = `<div class="page-container"><p>Relic set not found: ${setName}</p><p><a href="#">Go Home</a></p></div>`;
      previousPageInfo = {
        type: 'error',
        slug: setSlug,
        filters: null
      };
      return;
    }
    document.title = `${setName} - ${siteTitle}`;

    const setData = relicSetDetailsData.find((s) => s.Name === setName);
    let setInfoHtml = "";
    if (setData) {
      setInfoHtml += `<div class="relic-set-bonuses">`;
      if (setData["2-Piece Bonus"]) {
        setInfoHtml += `<h4>2-Piece Bonus</h4><p>${setData["2-Piece Bonus"]}</p>`;
      }
      if (setData["4-Piece Bonus"] && setData["4-Piece Bonus"].trim() !== "" && isActualRelic) { // 4-piece only for Cavern Relics
        setInfoHtml += `<h4>4-Piece Bonus</h4><p>${setData["4-Piece Bonus"]}</p>`;
      }
      setInfoHtml += `</div>`;
    }

    const charactersUsingSet = characterBuilds.filter(char => {
      return isActualOrnament ?
        char.planetarySetsAll.includes(setName) :
        char.relicSetsAll.includes(setName);
    });

    // Filter state initialization
    let selectedMainStats = {
      BODY: [],
      FEET: [],
      SPHERE: [],
      ROPE: []
    };
    let selectedSubStats = [];
    let substatLogic = 'OR'; // Default logic for substats

    // Load filters from sessionStorage if available (e.g., after back navigation)
    const cacheKey = `relicFilterState_${setSlug}`;
    const cachedFiltersJson = sessionStorage.getItem(cacheKey);
    if (cachedFiltersJson) {
      try {
        const cachedFilters = JSON.parse(cachedFiltersJson);
        selectedMainStats = cachedFilters.selectedMainStats || selectedMainStats;
        selectedSubStats = cachedFilters.selectedSubStats || selectedSubStats;
        substatLogic = cachedFilters.substatLogic || substatLogic;
      } catch (e) {
        console.error("Error parsing cached filters:", e);
        // sessionStorage.removeItem(cacheKey); // Corrupted data could be cleared
      } finally {
        sessionStorage.removeItem(cacheKey); // Always clear after attempting to load
      }
    }

    // Update global previousPageInfo for potential saving on navigation away from this page
    previousPageInfo = {
      type: 'relicSet',
      slug: setSlug,
      filters: {
        selectedMainStats,
        selectedSubStats,
        substatLogic
      }
    };

    // Determine which pieces are configurable for main stats (ornaments: Sphere/Rope; relics: Body/Feet)
    const displayablePieceOrder = isActualOrnament ? ["SPHERE", "ROPE"] : ["BODY", "FEET"];
    let mainStatsFilterHtml = '';

    displayablePieceOrder.forEach(piece => {
      const possibleMainStats = MAIN_STATS_SCHEMA[piece];
      // Head and Hands have fixed main stats, so they are not included here
      if (possibleMainStats && possibleMainStats.length > 0) {
        mainStatsFilterHtml += `<div class="filter-piece-group" data-piece-type="${piece}">
                <h5>${piece.charAt(0) + piece.slice(1).toLowerCase()}</h5>
                <div class="stat-options-grid">`;
        possibleMainStats.forEach(stat => {
          const usersCount = charactersUsingSet.filter(char => {
            const charPieceStats = getCharacterPieceStats(char, piece);
            return charPieceStats.includes(stat);
          }).length;
          const isUnused = usersCount === 0;
          const isActive = selectedMainStats[piece]?.includes(stat);
          mainStatsFilterHtml += `
                    <button class="stat-option main-stat-option ${isUnused ? 'unused-stat' : ''} ${isActive ? 'active' : ''}" 
                            data-stat-type="main" data-piece="${piece}" data-value="${stat}" 
                            title="${stat} - Used by ${usersCount} character(s) with this set"
                            ${isUnused ? 'disabled' : ''}>
                        <img class="stat-icon" src="images/stat-icon/${slugify(stat)}.webp" alt="${stat} icon">
                        <span class="stat-name">${stat}</span>
                        <span class="stat-count">(${usersCount})</span>
                    </button>`;
        });
        mainStatsFilterHtml += `</div></div>`;
      }
    });
    if (!mainStatsFilterHtml) mainStatsFilterHtml = "<p>No configurable main stats for this set type.</p>";

    let subStatsFilterHtml = '<div class="stat-options-grid">';
    SUBSTATS_CANONICAL.forEach(substat => {
      const usersCount = charactersUsingSet.filter(char => char.substatsClean.includes(substat)).length;
      const isUnused = usersCount === 0;
      const isActive = selectedSubStats.includes(substat);
      subStatsFilterHtml += `
            <button class="stat-option sub-stat-option ${isUnused ? 'unused-stat' : ''} ${isActive ? 'active' : ''}" 
                    data-stat-type="sub" data-value="${substat}"
                    title="${substat} - Prioritized by ${usersCount} character(s) with this set"
                    ${isUnused ? 'disabled' : ''}>
                <img class="stat-icon" src="images/stat-icon/${slugify(substat)}.webp" alt="${substat} icon">
                <span class="stat-name">${substat}</span>
                <span class="stat-count">(${usersCount})</span>
            </button>`;
    });
    subStatsFilterHtml += '</div>';

    appContent.innerHTML = `
      <div class="page-container">
          <div class="page-header">
               <div class="page-title-with-icon">
                  <img src="images/relic/${slugify(setName)}.webp" alt="${setName}" class="page-main-icon" loading="lazy">
                  <h2>${setName}</h2>
              </div>
          </div>
          ${setInfoHtml}
          <div class="relic-interactive-filter-area">
              <h3>Stat Usage Analysis</h3>
              <p>Select main stats and substats to find characters who benefit from this set with those stats. Stats marked with (0) are not used by any character with this set and are disabled.</p>
              
              <div class="filter-controls-panel">
                  <div class="filter-section">
                      <div class="filter-section-header">
                          <h4>Main Stats</h4>
                          <button class="collapse-toggle-btn" aria-expanded="true" aria-controls="main-stats-content">▼</button>
                      </div>
                      <div class="filter-section-content" id="main-stats-content">
                          ${mainStatsFilterHtml}
                      </div>
                  </div>

                  <div class="filter-section">
                      <div class="filter-section-header">
                          <h4>Substats</h4>
                           <button class="collapse-toggle-btn" aria-expanded="true" aria-controls="sub-stats-content">▼</button>
                      </div>
                      <div class="filter-section-content" id="sub-stats-content">
                          <div class="substats-logic-toggle">
                              <label><input type="radio" name="substat-logic" value="OR" ${substatLogic === 'OR' ? 'checked' : ''}> OR (any selected substat)</label>
                              <label><input type="radio" name="substat-logic" value="AND" ${substatLogic === 'AND' ? 'checked' : ''}> AND (all selected substats)</label>
                          </div>
                          ${subStatsFilterHtml}
                      </div>
                  </div>
                  <button id="reset-filters-btn" class="filter-button">Reset Filters</button>
              </div>

              <div class="filtered-results-section">
                  <h4 id="character-count-display"></h4>
                  <div id="filtered-character-list-container" class="item-list-scroll-container character-list">
                      ${/* Initial rendering will be handled by applyFiltersAndRenderResults */''}
                  </div>
                  <p id="no-filtered-results-message" style="display:none;">No characters match the selected criteria for this set.</p>
              </div>
          </div>
      </div>`;

    const characterListContainer = document.getElementById('filtered-character-list-container');
    const characterCountDisplay = document.getElementById('character-count-display');
    const noResultsMessage = document.getElementById('no-filtered-results-message');
    const filterArea = appContent.querySelector('.relic-interactive-filter-area');

    function updateCurrentFilterStateForPersistence() {
      // Ensure filters are saved for the current page context
      if (previousPageInfo.type === 'relicSet' && previousPageInfo.slug === setSlug) {
        previousPageInfo.filters = {
          selectedMainStats,
          selectedSubStats,
          substatLogic
        };
      }
    }

    function applyFiltersAndRenderResults() {
      let filteredCharacters = [...charactersUsingSet];

      // Filter by selected Main Stats
      const activeMainStatPieces = Object.keys(selectedMainStats).filter(piece => selectedMainStats[piece].length > 0);
      if (activeMainStatPieces.length > 0) {
        filteredCharacters = filteredCharacters.filter(char => {
          return activeMainStatPieces.every(pieceType => { // Character must match criteria for ALL pieces with selected main stats
            const charPieceStats = getCharacterPieceStats(char, pieceType);
            if (!charPieceStats || charPieceStats.length === 0) return false;
            // Character must have at least ONE of the selected main stats for this piece type
            return selectedMainStats[pieceType].some(selStat => charPieceStats.includes(selStat));
          });
        });
      }

      // Filter by selected Substats
      if (selectedSubStats.length > 0) {
        filteredCharacters = filteredCharacters.filter(char => {
          if (substatLogic === 'OR') {
            return selectedSubStats.some(sub => char.substatsClean.includes(sub));
          } else { // AND logic
            return selectedSubStats.every(sub => char.substatsClean.includes(sub));
          }
        });
      }

      characterCountDisplay.textContent = `Showing ${filteredCharacters.length} of ${charactersUsingSet.length} character(s) for this set.`;

      if (filteredCharacters.length > 0) {
        characterListContainer.innerHTML = _renderItemsList(filteredCharacters.map(c => c.name), "character", "Matching Characters", "character-list-icon");
        noResultsMessage.style.display = 'none';
        characterListContainer.style.display = '';
      } else {
        characterListContainer.innerHTML = '';
        noResultsMessage.style.display = 'block';
        characterListContainer.style.display = 'none';
      }
      updateCurrentFilterStateForPersistence(); // Update state for persistence on navigation
    }

    // Event delegation for filter controls
    filterArea.addEventListener('click', (event) => {
      const statButton = event.target.closest('button.stat-option:not(:disabled)');
      const resetBtn = event.target.closest('#reset-filters-btn');
      const filterHeader = event.target.closest('.filter-section-header');
      const collapseToggleBtn = filterHeader ? filterHeader.querySelector('.collapse-toggle-btn') : event.target.closest('.collapse-toggle-btn');

      if (statButton) {
        statButton.classList.toggle('active');
        const statType = statButton.dataset.statType;
        const value = statButton.dataset.value;

        if (statType === 'main') {
          const piece = statButton.dataset.piece;
          if (!selectedMainStats[piece]) selectedMainStats[piece] = [];

          if (statButton.classList.contains('active')) {
            if (!selectedMainStats[piece].includes(value)) selectedMainStats[piece].push(value);
          } else {
            selectedMainStats[piece] = selectedMainStats[piece].filter(s => s !== value);
          }
        } else if (statType === 'sub') {
          if (statButton.classList.contains('active')) {
            if (!selectedSubStats.includes(value)) selectedSubStats.push(value);
          } else {
            selectedSubStats = selectedSubStats.filter(s => s !== value);
          }
        }
        applyFiltersAndRenderResults();
      } else if (resetBtn) {
        selectedMainStats = {
          BODY: [],
          FEET: [],
          SPHERE: [],
          ROPE: []
        };
        selectedSubStats = [];
        substatLogic = 'OR'; // Reset to default
        filterArea.querySelectorAll('button.stat-option.active').forEach(btn => btn.classList.remove('active'));
        const orRadio = filterArea.querySelector('input[name="substat-logic"][value="OR"]');
        if (orRadio) orRadio.checked = true;

        // Reset collapse states to expanded
        filterArea.querySelectorAll('.collapse-toggle-btn').forEach(btn => {
          const contentId = btn.getAttribute('aria-controls');
          const contentElement = document.getElementById(contentId);
          btn.setAttribute('aria-expanded', 'true');
          if (contentElement) contentElement.style.display = ''; // Show content
          btn.textContent = '▼'; // Set to expanded icon
        });

        applyFiltersAndRenderResults();
      } else if (collapseToggleBtn) {
        const contentId = collapseToggleBtn.getAttribute('aria-controls');
        const contentElement = document.getElementById(contentId);
        const isExpanded = collapseToggleBtn.getAttribute('aria-expanded') === 'true';

        collapseToggleBtn.setAttribute('aria-expanded', String(!isExpanded));
        if (contentElement) contentElement.style.display = isExpanded ? 'none' : '';
        collapseToggleBtn.textContent = isExpanded ? '▶' : '▼'; // Toggle icon
      }
    });

    filterArea.addEventListener('change', (event) => {
      if (event.target.name === 'substat-logic') {
        substatLogic = event.target.value;
        applyFiltersAndRenderResults();
      }
    });

    // Initial application of filters (especially if loaded from cache) & results rendering
    applyFiltersAndRenderResults();
  }

  // --- Search Popup Logic ---
  function openSearchPopup() {
    searchPopup.style.display = "flex";
    universalSearchInput.value = lastUniversalSearchQueryValue; // Restore previous query for this session
    universalSearchInput.focus();
    document.body.style.overflow = "hidden"; // Prevent background scrolling
    handleUniversalSearch(); // Populate results if there was a previous query
    currentSearchFocusIndex = -1; // Reset focus
    removeSearchItemFocus();
  }

  function closeSearchPopup() {
    searchPopup.style.display = "none";
    universalSearchResults.innerHTML = '<p class="search-prompt">Type to start searching.</p>';
    document.body.style.overflow = ""; // Restore scrolling
    currentSearchFocusIndex = -1;
    searchableListItems = []; // Clear list items
  }

  function removeSearchItemFocus() {
    searchableListItems.forEach((item) => item.classList.remove("focused-search-item"));
  }

  function addSearchItemFocus(index) {
    removeSearchItemFocus();
    if (searchableListItems[index]) {
      searchableListItems[index].classList.add("focused-search-item");
      // Scroll the focused item into view if not fully visible
      searchableListItems[index].scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
      currentSearchFocusIndex = index;
    }
  }

  function handleUniversalSearch() {
    const currentInputValue = universalSearchInput.value;
    lastUniversalSearchQueryValue = currentInputValue; // Remember for session
    const query = currentInputValue.trim().toLowerCase();

    currentSearchFocusIndex = -1; // Reset focus on new search
    removeSearchItemFocus();

    if (!query) {
      universalSearchResults.innerHTML = '<p class="search-prompt">Type to start searching.</p>';
      searchableListItems = [];
      return;
    }

    let html = "";
    const matchingRelics = RELIC_SETS_DATA
      .filter((name) => name.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b)); // Sort alphabetically
    if (matchingRelics.length > 0) {
      html += '<h3>Cavern Relics</h3><ul class="search-results-list">';
      matchingRelics.forEach((name) => {
        const slug = slugify(name);
        html += `<li><a href="#/relics/${slug}"><img src="images/relic/${slug}.webp" alt="" class="item-icon search-result-icon" loading="lazy">${name}</a></li>`;
      });
      html += "</ul>";
    }

    const matchingOrnaments = ORNAMENT_SETS_DATA
      .filter((name) => name.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b));
    if (matchingOrnaments.length > 0) {
      html += '<h3>Planar Ornaments</h3><ul class="search-results-list">';
      matchingOrnaments.forEach((name) => {
        const slug = slugify(name);
        html += `<li><a href="#/ornaments/${slug}"><img src="images/relic/${slug}.webp" alt="" class="item-icon search-result-icon" loading="lazy">${name}</a></li>`;
      });
      html += "</ul>";
    }

    const matchingCharacters = [...allCharacters] // Use spread to ensure it's a new array if allCharacters could be modified elsewhere
      .filter((name) => name.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b));
    if (matchingCharacters.length > 0) {
      html += '<h3>Characters</h3><ul class="search-results-list">';
      matchingCharacters.forEach((name) => {
        const slug = slugify(name);
        html += `<li><a href="#/characters/${slug}"><img src="images/character/${slug}.webp" alt="" class="item-icon search-result-icon" loading="lazy">${name}</a></li>`;
      });
      html += "</ul>";
    }

    if (!html) {
      universalSearchResults.innerHTML = '<p class="search-prompt">No results found.</p>';
      searchableListItems = [];
    } else {
      universalSearchResults.innerHTML = html;
      // Update the list of items that can be navigated with arrow keys
      searchableListItems = Array.from(universalSearchResults.querySelectorAll(".search-results-list li"));
    }

    // Add click listeners to new links to close popup on navigation
    universalSearchResults.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeSearchPopup);
    });
  }

  // --- Navigation and Routing ---
  function updateActiveNav(currentHash) {
    const navLinks = mainNav.querySelectorAll("a, button");
    navLinks.forEach((link) => link.classList.remove("active"));

    let activeLink;
    // Determine active link based on hash, ensuring it's a list page, not a detail page
    if (currentHash.startsWith("#/relics") && !currentHash.includes("/", "#/relics".length + 1)) {
      activeLink = mainNav.querySelector('a[data-nav-path="/relics"]');
    } else if (currentHash.startsWith("#/ornaments") && !currentHash.includes("/", "#/ornaments".length + 1)) {
      activeLink = mainNav.querySelector('a[data-nav-path="/ornaments"]');
    } else if (currentHash.startsWith("#/characters") && !currentHash.includes("/", "#/characters".length + 1)) {
      activeLink = mainNav.querySelector('a[data-nav-path="/characters"]');
    } else if (currentHash === "#/" || currentHash === "") { // Home page
      activeLink = mainNav.querySelector('a[data-nav-path="/"]');
    }
    // If no specific list page match, no main nav item will be active (e.g., on detail pages)
    if (activeLink) activeLink.classList.add("active");
  }

  function handleRouteChange() {
    // Save filter state of the previous relic set page before navigating away
    if (previousPageInfo.type === 'relicSet' && previousPageInfo.slug && previousPageInfo.filters) {
      const cacheKey = `relicFilterState_${previousPageInfo.slug}`;
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(previousPageInfo.filters));
      } catch (e) {
        console.error("Error saving filters to sessionStorage:", e);
      }
    }

    const hash = location.hash;
    const loadingContainer = document.querySelector(".loading-container");
    if (loadingContainer) loadingContainer.style.display = "none"; // Hide loading once routing starts

    // Simple hash-based router
    if (hash === "#/relics") renderCavernRelicsPage();
    else if (hash === "#/ornaments") renderPlanarOrnamentsPage();
    else if (hash === "#/characters") renderCharactersListPage();
    else if (hash.startsWith("#/characters/")) {
      const charSlug = hash.substring("#/characters/".length);
      // Find character name by slug, or fallback to deslugify (less reliable but a guess)
      const charName = allCharacters.find(name => slugify(name) === charSlug) || findOriginalSetName(charSlug);
      renderCharacterPage(charName);
    } else if (hash.startsWith("#/ornaments/")) {
      const ornamentSlug = hash.substring("#/ornaments/".length);
      renderRelicSetPage(ornamentSlug);
    } else if (hash.startsWith("#/relics/")) {
      const relicSlug = hash.substring("#/relics/".length);
      renderRelicSetPage(relicSlug);
    } else { // Default to home page
      renderHomePage();
    }
    updateActiveNav(hash);
    window.scrollTo(0, 0); // Scroll to top on page change
  }

  // --- Application Initialization ---
  async function initApp() {
    try {
      const [buildDataResponse, relicInfoResponse] = await Promise.all([
        fetch(BUILD_DATA_URL), fetch(RELIC_INFO_URL),
      ]);

      if (!buildDataResponse.ok) throw new Error(`HTTP error ${buildDataResponse.status} fetching character builds.`);
      if (!relicInfoResponse.ok) throw new Error(`HTTP error ${relicInfoResponse.status} fetching relic info.`);

      const rawBuildData = await buildDataResponse.json();
      relicSetDetailsData = await relicInfoResponse.json(); // Store raw relic details

      // Populate RELIC_SETS_DATA and ORNAMENT_SETS_DATA from relicSetDetailsData
      const relicIdLookup = new Map(relicSetDetailsData.map(item => [item.Name, item.ID]));
      const tempRelicSets = new Set(),
        tempOrnamentSets = new Set();

      relicSetDetailsData.forEach((item) => {
        if (item.Name && typeof item.Name === "string") {
          if (item.Type === "Relic Set") tempRelicSets.add(item.Name);
          else if (item.Type === "Planetary Ornament Set") tempOrnamentSets.add(item.Name);
        }
      });
      // Sort by ID descending (newer sets first)
      RELIC_SETS_DATA = Array.from(tempRelicSets).sort((a, b) => (relicIdLookup.get(b) || 0) - (relicIdLookup.get(a) || 0));
      ORNAMENT_SETS_DATA = Array.from(tempOrnamentSets).sort((a, b) => (relicIdLookup.get(b) || 0) - (relicIdLookup.get(a) || 0));

      // Create a combined list of all set names, sorted by length for parsing
      ALL_KNOWN_SETS_SORTED = [...RELIC_SETS_DATA, ...ORNAMENT_SETS_DATA].sort((a, b) => b.length - a.length);

      // Populate lookup maps for set names
      ALL_KNOWN_SETS_SORTED.forEach(set => {
        ALL_KNOWN_SETS_SLUG_MAP.set(slugify(set), set);
        ALL_KNOWN_SETS_NORMALIZED_MAP.set(set.toLowerCase().replace(/[^a-z0-9]/g, ""), set);
      });

      processData(rawBuildData); // Process character build data

      // Sort characters by release version (desc) then ID (asc)
      characterBuilds.sort((a, b) => {
        if (b.Release !== a.Release) return (b.Release || 0) - (a.Release || 0);
        return (a.ID || 0) - (b.ID || 0);
      });
      allCharacters = characterBuilds.map((c) => c.name); // Extract character names

      // General click listener for delegated events (if any such elements exist)
      // Note: .char-count-toggle is not used in current rendering functions but kept for compatibility
      appContent.addEventListener("click", function(event) {
        const toggleElement = event.target.closest(".char-count-toggle");
        if (toggleElement && !toggleElement.classList.contains("no-users")) {
          event.preventDefault();
          const targetId = toggleElement.dataset.targetId;
          const targetElement = document.getElementById(targetId);
          if (targetElement) {
            const isHidden = targetElement.style.display === "none" || !targetElement.style.display;
            targetElement.style.display = isHidden ? "block" : "none";
          }
        }
      });

      // --- Search Popup Event Listeners ---
      navSearchButton.addEventListener("click", openSearchPopup);
      searchPopup.addEventListener("click", (event) => { // Close if backdrop is clicked
        if (event.target === searchPopup) closeSearchPopup();
      });
      universalSearchInput.addEventListener("input", handleUniversalSearch);
      universalSearchInput.addEventListener("focus", () => { // Reset focus index when input is focused
        currentSearchFocusIndex = -1;
        removeSearchItemFocus();
      });
      universalSearchClearBtn.addEventListener("click", () => {
        if (universalSearchInput.value) { // If there's text, clear it and refocus
          universalSearchInput.value = "";
          lastUniversalSearchQueryValue = "";
          handleUniversalSearch();
          universalSearchInput.focus();
        } else { // If already empty, close the popup
          closeSearchPopup();
        }
      });

      // --- Global Keyboard Shortcuts ---
      document.addEventListener("keydown", (event) => {
        if (searchPopup.style.display === "flex") { // Search popup is active
          if (event.key === "Escape") closeSearchPopup();
          else if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
            event.preventDefault();
            if (searchableListItems.length > 0) {
              currentSearchFocusIndex = (currentSearchFocusIndex + 1) % searchableListItems.length;
              addSearchItemFocus(currentSearchFocusIndex);
            }
          } else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
            event.preventDefault();
            if (searchableListItems.length > 0) {
              currentSearchFocusIndex = (currentSearchFocusIndex - 1 + searchableListItems.length) % searchableListItems.length;
              if (currentSearchFocusIndex < 0) currentSearchFocusIndex = searchableListItems.length - 1; // Ensure positive index
              addSearchItemFocus(currentSearchFocusIndex);
            }
          } else if (event.key === "Enter") {
            if (document.activeElement === universalSearchInput && currentSearchFocusIndex === -1) {
              // If Enter is pressed in search input and no item is focused, click first result
              if (searchableListItems.length > 0) {
                event.preventDefault();
                const firstResultLink = searchableListItems[0].querySelector("a");
                if (firstResultLink) firstResultLink.click();
              }
            } else if (currentSearchFocusIndex !== -1 && searchableListItems[currentSearchFocusIndex]) {
              // If an item is focused, click it
              event.preventDefault();
              const linkToClick = searchableListItems[currentSearchFocusIndex].querySelector("a");
              if (linkToClick) linkToClick.click();
            }
          }
        } else { // Search popup is not active
          if (event.key === "/") { // Global shortcut to open search
            const activeElement = document.activeElement;
            const isTyping = activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable);
            if (!isTyping) { // Avoid hijacking typing in inputs
              event.preventDefault();
              openSearchPopup();
            }
          }
        }
      });

      handleRouteChange(); // Initial route handling
    } catch (error) {
      console.error("Initialization failed:", error);
      document.title = `Error - ${siteTitle}`;
      appContent.innerHTML = `<div class="page-container"><p>Error loading application data. Details: ${error.message}</p></div>`;
      const loadingContainer = document.querySelector(".loading-container");
      if (loadingContainer) loadingContainer.style.display = "none";
    }
  }

  // --- Event Listener for Hash Changes ---
  window.addEventListener("hashchange", handleRouteChange);

  // --- Start the Application ---
  initApp();

})();