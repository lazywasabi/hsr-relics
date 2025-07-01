(function () {
  "use strict";

  // --- Configuration ---
  const BUILD_DATA_URL = "data/characters.json";
  const RELIC_INFO_URL = "data/relics.json";
  const SITE_TITLE = "Relic Salvaging Helper for Honkai: Star Rail";

  // --- DOM Elements ---
  const appContent = document.getElementById("app-content");
  const searchPopup = document.getElementById("search-popup");
  const universalSearchInput = document.getElementById("universal-search-input");
  const universalSearchResults = document.getElementById("universal-search-results");
  const universalSearchClearBtn = document.getElementById("universal-search-clear-btn");
  const navSearchButton = document.getElementById("nav-search-button");
  const mainNav = document.getElementById("main-nav");

  // --- Application Data (populated on init) ---
  let RELIC_SETS_DATA = [];      // Cavern Relics, sorted by ID desc
  let ORNAMENT_SETS_DATA = [];   // Planar Ornaments, sorted by ID desc
  let ALL_KNOWN_SETS_SORTED = [];// All sets, sorted by name length desc for parsing
  let relicSetDetailsData = [];  // Raw data from relics.json
  let characterBuilds = [];      // Processed character data, sorted

  // Precomputed maps for faster lookups
  const ALL_KNOWN_SETS_SLUG_MAP = new Map();      // Map<slug, originalSetName>
  const ALL_KNOWN_SETS_NORMALIZED_MAP = new Map();// Map<normalizedName, originalSetName>
  const RELIC_GROUP_MAP = new Map();              // Map<groupName, Set<setName>>

  // --- Static Schemas & Aliases ---
  const MAIN_STATS_SCHEMA = {
    HEAD: ["HP"],
    HANDS: ["ATK"],
    BODY: ["HP%", "DEF%", "ATK%", "CRIT Rate", "CRIT DMG", "Effect HIT Rate", "Outgoing Healing"],
    FEET: ["HP%", "DEF%", "ATK%", "Speed"],
    SPHERE: ["HP%", "DEF%", "ATK%", "Physical DMG", "Fire DMG", "Ice DMG", "Wind DMG", "Lightning DMG", "Quantum DMG", "Imaginary DMG"],
    ROPE: ["HP%", "DEF%", "ATK%", "Break Effect", "Energy Regen Rate"],
  };

  const SUBSTATS_CANONICAL = ["HP", "DEF", "ATK", "HP%", "DEF%", "ATK%", "Speed", "CRIT Rate", "CRIT DMG", "Break Effect", "Effect Hit Rate", "Effect RES"];
  const SORTED_SUBSTATS_CANONICAL_BY_LENGTH = [...SUBSTATS_CANONICAL].sort((a, b) => b.length - a.length);
  const SUBSTATS_CANONICAL_LOWER = SUBSTATS_CANONICAL.map((s) => s.toLowerCase());

  const SUBSTAT_ALIASES = { // Keys are lowercase for consistent matching
    hp: "HP%", def: "DEF%", atk: "ATK%", spd: "Speed", ehr: "Effect Hit Rate", "ehr%": "Effect Hit Rate",
    "eff res": "Effect RES", "eff res%": "Effect RES", "crit rate": "CRIT Rate", "crit dmg": "CRIT DMG",
    "break effect%": "Break Effect",
  };
  
  const CHARACTER_FILTER_CONFIG = {
    rank: { label: "Rank", options: ["5", "4"] },
    type: { label: "Type", options: ["Physical", "Fire", "Ice", "Lightning", "Wind", "Quantum", "Imaginary"] },
    path: { label: "Path", options: ["Destruction", "The Hunt", "Erudition", "Harmony", "Nihility", "Preservation", "Abundance", "Remembrance"] }
  };

  // --- Application State ---
  let searchableListItems = [];
  let currentSearchFocusIndex = -1;
  let previousPageInfo = { type: null, slug: null, filters: null };
  let characterListFilters = { rank: new Set(), type: new Set(), path: new Set() };


  // --- Utility Functions ---
  function slugify(text) {
    if (!text) return "";
    return text.toString().toLowerCase()
      .replace(/\s+/g, "-").replace(/[^\w-]+/g, "").replace(/--+/g, "-");
  }

  function deslugify(slug) {
    if (!slug) return "";
    return slug.replace(/-/g, " ")
      .split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  }

  /**
   * Finds the original set name from a slug using precomputed maps.
   */
  function findOriginalSetName(slug) {
    if (!slug) return "";
    if (ALL_KNOWN_SETS_SLUG_MAP.has(slug)) {
      return ALL_KNOWN_SETS_SLUG_MAP.get(slug);
    }
    const normalizedSlug = slug.toLowerCase().replace(/-/g, "");
    if (ALL_KNOWN_SETS_NORMALIZED_MAP.has(normalizedSlug)) {
      return ALL_KNOWN_SETS_NORMALIZED_MAP.get(normalizedSlug);
    }
    const potentialName = deslugify(slug);
    return ALL_KNOWN_SETS_SLUG_MAP.has(slugify(potentialName)) ? potentialName : potentialName;
  }
  
  /**
   * Gets the recommended main stats for a specific relic piece for a character.
   */
  function getCharacterPieceStats(character, pieceType) {
    if (!character || !pieceType) return [];
    const pTypeLower = pieceType.toLowerCase();
    const pieceKeyMap = { sphere: 'planarSphere', rope: 'linkRope' };
    const key = pieceKeyMap[pTypeLower] || pTypeLower;
    return character[key] || [];
  }


  // --- Data Parsing Functions ---

  /**
   * Parses a string of relic set names, handling comma separation,
   * concatenation, and "Group:" aliases.
   */
  function parseSetListString(setString) {
    if (typeof setString !== 'string' || !setString) return [];
    
    const foundSets = new Set();
    let remainingString = setString.trim();
    const groupPrefix = "Group:";

    while (remainingString.length > 0) {
      let matched = false;
      
      // Attempt to match a "Group:XXX" alias first
      if (remainingString.startsWith(groupPrefix)) {
        let groupTokenEndIndex = remainingString.indexOf(',') > -1 ? remainingString.indexOf(',') : remainingString.length;
        const groupToken = remainingString.substring(0, groupTokenEndIndex).trim();
        const groupName = groupToken.substring(groupPrefix.length);

        if (RELIC_GROUP_MAP.has(groupName)) {
          RELIC_GROUP_MAP.get(groupName).forEach(set => foundSets.add(set));
          matched = true;
        } else {
          console.warn(`Unknown relic group: ${groupToken}`);
        }
        
        remainingString = remainingString.substring(groupToken.length).trim().replace(/^,/, '').trim();
        if(matched) continue;
      }

      // If no group matched, attempt to match a standard set name
      for (const setName of ALL_KNOWN_SETS_SORTED) {
        if (remainingString.startsWith(setName)) {
          foundSets.add(setName);
          remainingString = remainingString.substring(setName.length).trim().replace(/^,/, '').trim();
          matched = true;
          break; // Found the longest possible match, restart loop
        }
      }

      if (!matched) {
        // Avoid infinite loop on unparseable string segments
        if (remainingString.length > 0) {
          console.warn(`Unparseable relic string segment: "${remainingString.substring(0, 20)}..."`);
        }
        break;
      }
    }
    return Array.from(foundSets);
  }

  /**
   * Parses a substat priority string into canonical names and preserves the original comment.
   */
  function parseSubstats(substatStr) {
    if (!substatStr) return { clean: [], comment: "" };

    let tempStr = substatStr.replace(/\([^)]*\)|\[[^\]]*\]/g, "").trim();
    const parts = tempStr.split(/[>≥=/,]+/);
    const seenSubstats = new Set();

    parts.forEach(part => {
      let potentialStat = part.trim().toLowerCase();
      if (!potentialStat) return;

      let matchedCanonicalStat = SUBSTAT_ALIASES[potentialStat] || null;

      if (!matchedCanonicalStat) {
        const canonicalIndex = SUBSTATS_CANONICAL_LOWER.indexOf(potentialStat);
        if (canonicalIndex !== -1) {
          matchedCanonicalStat = SUBSTATS_CANONICAL[canonicalIndex];
        }
      }

      if (!matchedCanonicalStat) {
        for (const canonical of SORTED_SUBSTATS_CANONICAL_BY_LENGTH) {
          if (potentialStat.includes(canonical.toLowerCase())) {
            matchedCanonicalStat = canonical;
            break;
          }
        }
      }

      if (matchedCanonicalStat && !seenSubstats.has(matchedCanonicalStat)) {
        seenSubstats.add(matchedCanonicalStat);
      }
    });

    return { clean: Array.from(seenSubstats), comment: substatStr };
  }
  
  function aggregateAllSets(item, basePropName, numSlots = 5) {
    const allSets = new Set();
    for (let i = 1; i <= numSlots; i++) {
      if (item[`${basePropName}${i}`]) {
        parseSetListString(item[`${basePropName}${i}`]).forEach(set => allSets.add(set));
      }
    }
    return Array.from(allSets);
  }

  function processData(jsonData) {
    characterBuilds = jsonData.map((item) => {
      const substatsParsed = parseSubstats(item.Substats);
      const allRelicSets = aggregateAllSets(item, "Relic");
      const allPlanetarySets = aggregateAllSets(item, "Planetary");

      return {
        name: item.Name,
        displayName: item["Display Name"] || item.Name,
        rank: item.Rank,
        type: item.Type,
        path: item.Path,
        ID: item.ID,
        Release: item.Release,
        body: item.Body?.split(",").map((s) => s.trim()) ?? [],
        feet: item.Feet?.split(",").map((s) => s.trim()) ?? [],
        planarSphere: item["Planar Sphere"]?.split(",").map((s) => s.trim()) ?? [],
        linkRope: item["Link Rope"]?.split(",").map((s) => s.trim()) ?? [],
        relicSetsAll: allRelicSets,
        planetarySetsAll: allPlanetarySets,
        relic1: parseSetListString(item.Relic1),
        relic2: parseSetListString(item.Relic2),
        relic3: parseSetListString(item.Relic3),
        relic4: parseSetListString(item.Relic4),
        relic5: parseSetListString(item.Relic5),
        planetary1: parseSetListString(item.Planetary1),
        planetary2: parseSetListString(item.Planetary2),
        planetary3: parseSetListString(item.Planetary3),
        planetary4: parseSetListString(item.Planetary4),
        planetary5: parseSetListString(item.Planetary5),
        substatsClean: substatsParsed.clean,
        substatsComment: substatsParsed.comment,
      };
    });
  }


  // --- Rendering Functions ---

  function _renderItemsList(items, itemType, listTitle, itemClass = "") {
    if (items.length === 0) {
      return `<ul class="content-list item-grid-list"><li class="no-results-in-list">No ${listTitle.toLowerCase()} found.</li></ul>`;
    }
    const listHtml = items.map((item) => {
      let name, slug, href, imgSrc, extraClasses = "";

      if (itemType === "cavern-relic" || itemType === "planar-ornament") {
        name = item;
        slug = slugify(name);
        href = itemType === "cavern-relic" ? `#/relics/${slug}` : `#/ornaments/${slug}`;
        imgSrc = `images/relic/${slug}.webp`;
      } else { // character
        name = item.displayName;
        slug = slugify(item.name);
        href = `#/characters/${slug}`;
        imgSrc = `images/character/${slug}.webp`;
        extraClasses = `character-rank-${item.rank} character-type-${slugify(item.type)} character-path-${slugify(item.path)}`;
      }
      return `<li class="${extraClasses}"><a href="${href}" title="${name}"><img src="${imgSrc}" alt="" class="item-icon ${itemClass}"><span>${name}</span></a></li>`;
    }).join("");
    return `<ul class="content-list item-grid-list">${listHtml}</ul>`;
  }
  
  function _renderItemsSublist(items, type, title, itemClass, limit) {
    const limitedItems = limit > 0 ? items.slice(0, limit) : items;
    const isOrnament = type === 'planar-ornament';
    const linkPath = isOrnament ? 'ornaments' : `${type}s`;
    const itemTypeForList = (type === 'relic') ? 'cavern-relic' : type;

    return `
      <section class="home-section">
          <div class="page-header"><a href="/#/${linkPath}"><img src="/images/icon/${type}.svg"><h2>${title}</h2></a></div>
          <div class="item-list-scroll-container character-list">
              ${_renderItemsList(limitedItems, itemTypeForList, title, itemClass)}
          </div>
      </section>
    `;
  }

  function renderHomePage() {
    const homeNotice = document.querySelector("#homeNotice").content.cloneNode(true);
    document.title = SITE_TITLE;
    appContent.innerHTML = `
      <div class="page-container home-page-layout">
        ${_renderItemsSublist(RELIC_SETS_DATA, "relic", "Cavern Relics", "character-list-icon", 8)}
        ${_renderItemsSublist(ORNAMENT_SETS_DATA, "planar-ornament", "Planar Ornaments", "character-list-icon", 8)}
        ${_renderItemsSublist(characterBuilds, "character", "Characters", "character-list-icon", 8)}
      </div>`;
    appContent.prepend(homeNotice);
    previousPageInfo = { type: 'home', slug: null, filters: null };
  }

  function renderListPage(title, data, itemType, itemClass) {
    document.title = `${title} - ${SITE_TITLE}`;
    appContent.innerHTML = `
      <div class="page-container">
          <div class="page-header"><h2>${title}</h2></div>
          <div class="item-list-scroll-container full-page-list">
              ${_renderItemsList(data, itemType, title, itemClass)}
          </div>
      </div>`;
    previousPageInfo = { type: `${itemType}List`, slug: null, filters: null };
  }

  function renderCavernRelicsPage() {
    renderListPage("Cavern Relics", RELIC_SETS_DATA, "cavern-relic", "relic-list-icon");
  }

  function renderPlanarOrnamentsPage() {
    renderListPage("Planar Ornaments", ORNAMENT_SETS_DATA, "planar-ornament", "relic-list-icon");
  }

  function _renderCharacterFilterBar(containerId = 'character-filter-bar') {
    let filterHtml = `<div id="${containerId}" class="character-filter-bar"><button class="filter-reset-btn" title="All characters"><img src="/images/icon/asterisk.svg"></button>`;
    for (const [type, config] of Object.entries(CHARACTER_FILTER_CONFIG)) {
        filterHtml += `<div class="filter-group" data-filter-type="${type}">`;
        config.options.forEach(value => {
            const isActive = characterListFilters[type].has(value);
            const iconSlug = type === 'rank' ? `rank-${value}` : slugify(value);
            const title = type === 'rank' ? `${value} Stars` : value;
            filterHtml += `<button class="filter-option ${isActive ? 'active' : ''}" data-filter-value="${value}" title="${title}"><img src="/images/game-icon/${iconSlug}.webp" alt="${title}"></button>`;
        });
        filterHtml += `</div>`;
    }
    filterHtml += `</div>`;
    return filterHtml;
  }
  
  function applyCharacterFilters(characters) {
    const isAnyFilterActive = Object.values(characterListFilters).some(s => s.size > 0);
    if (!isAnyFilterActive) return characters;

    return characters.filter(char => {
        return Object.entries(characterListFilters).every(([type, filterSet]) => {
            return filterSet.size === 0 || filterSet.has(char[type].toString());
        });
    });
  }

  function renderCharactersListPage() {
    document.title = `Characters - ${SITE_TITLE}`;
    
    appContent.innerHTML = `
      <div class="page-container">
          <div class="page-header"><h2>Characters</h2></div>
          <div id="character-list-controls">${_renderCharacterFilterBar('main-character-filter-bar')}</div>
          <div id="character-list-container" class="item-list-scroll-container full-page-list character-list"></div>
          <p id="no-filtered-characters-message" style="display:none;">No characters match the selected filters.</p>
      </div>`;

    const listContainer = document.getElementById('character-list-container');
    const noResultsMessage = document.getElementById('no-filtered-characters-message');
    const filterBar = document.getElementById('main-character-filter-bar');

    const renderFilteredList = () => {
        const filteredCharacters = applyCharacterFilters(characterBuilds);
        const hasResults = filteredCharacters.length > 0;
        
        listContainer.innerHTML = hasResults ? _renderItemsList(filteredCharacters, "character", "Characters", "character-list-icon") : '';
        listContainer.style.display = hasResults ? '' : 'none';
        noResultsMessage.style.display = hasResults ? 'none' : 'block';
    };
    
    filterBar.addEventListener('click', (event) => {
        const filterBtn = event.target.closest('.filter-option');
        const resetBtn = event.target.closest('.filter-reset-btn');

        if (filterBtn) {
            const type = filterBtn.parentElement.dataset.filterType;
            const value = filterBtn.dataset.filterValue;
            if (characterListFilters[type].has(value)) {
                characterListFilters[type].delete(value);
                filterBtn.classList.remove('active');
            } else {
                characterListFilters[type].add(value);
                filterBtn.classList.add('active');
            }
        } else if (resetBtn) {
            Object.values(characterListFilters).forEach(set => set.clear());
            filterBar.querySelectorAll('.filter-option.active').forEach(btn => btn.classList.remove('active'));
        }
        if(filterBtn || resetBtn) renderFilteredList();
    });

    renderFilteredList(); // Initial render
    previousPageInfo = { type: 'characterList', slug: null, filters: null };
  }

  function renderCharacterPage(characterName) {
    const character = characterBuilds.find((c) => c.name === characterName);
    if (!character) {
      document.title = `Not Found - ${SITE_TITLE}`;
      appContent.innerHTML = `<div class="page-container"><p>Character not found: ${characterName}</p><p><a href="#">Go Home</a></p></div>`;
      previousPageInfo = { type: 'error', slug: characterName, filters: null };
      return;
    }
    
    document.title = `${character.displayName} - ${SITE_TITLE}`;

    const formatSetList = (sets) => {
      if (!sets || sets.length === 0) return "N/A";
      return sets.map(s => {
        const slug = slugify(s);
        const href = ORNAMENT_SETS_DATA.includes(s) ? `#/ornaments/${slug}` : `#/relics/${slug}`;
        return `<span class="set-name-link"><a href="${href}"><img src="images/relic/${slug}.webp" alt="" class="item-icon inline-icon"><span class="set-name-text">${s}</span></a></span>`;
      }).join("");
    };

    const renderRecommendations = (recommendations, title, type) => {
      const validRecs = recommendations.filter(r => r && r.length > 0);
      let content;
      if (validRecs.length > 0) {
        content = validRecs.map((recSet, index) => {
          let optionTitle = `Option ${index + 1}`;
          if (type === 'relic' && recSet.length >= 2 && recSet.every(setName => RELIC_SETS_DATA.includes(setName))) {
            optionTitle += " (2 pcs + 2 pcs)";
          }
          return `<div class="stat-group"><h4>${optionTitle}</h4><p class="relic-option-list">${formatSetList(recSet)}</p></div>`;
        }).join("");
      } else {
        content = `<p>No specific ${type} recommendations found.</p>`;
      }
      return `<div class="build-section"><h3>${title}</h3><div class="build-grid">${content}</div></div>`;
    };

    const relicRecs = [character.relic1, character.relic2, character.relic3, character.relic4, character.relic5];
    const ornamentRecs = [character.planetary1, character.planetary2, character.planetary3, character.planetary4, character.planetary5];

    appContent.innerHTML = `
      <div class="page-container">
          <div class="page-header"><div class="page-title-with-icon"><img src="images/character-sticker/${slugify(character.name)}.webp" alt="${character.displayName}" class="page-main-icon"><h2>${character.displayName}</h2></div></div>
          ${renderRecommendations(relicRecs, "Cavern Relics", "relic")}
          ${renderRecommendations(ornamentRecs, "Planar Ornaments", "ornament")}
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
                  <ul>${character.substatsClean.map((s) => `<li>${s}</li>`).join("") || "<li>No specific substat priorities listed.</li>"}</ul>
                  ${character.substatsComment ? `<div class="substat-comment"><strong>Note:</strong> ${character.substatsComment}</div>` : ""}
              </div>
          </div>
      </div>`;
    previousPageInfo = { type: 'characterPage', slug: slugify(character.name), filters: null };
  }

  function renderRelicSetPage(setSlug) {
    const setName = findOriginalSetName(setSlug);
    const isOrnament = ORNAMENT_SETS_DATA.includes(setName);
    const isRelic = RELIC_SETS_DATA.includes(setName);

    if (!isOrnament && !isRelic) {
      document.title = `Not Found - ${SITE_TITLE}`;
      appContent.innerHTML = `<div class="page-container"><p>Relic set not found: ${setName}</p><p><a href="#">Go Home</a></p></div>`;
      previousPageInfo = { type: 'error', slug: setSlug, filters: null };
      return;
    }
    document.title = `${setName} - ${SITE_TITLE}`;

    const setData = relicSetDetailsData.find(s => s.Name === setName);
    let setInfoHtml = "";
    if (setData) {
        setInfoHtml = `<div class="relic-set-bonuses">
            ${setData["2-Piece Bonus"] ? `<h4>2-Piece Bonus</h4><p>${setData["2-Piece Bonus"]}</p>` : ''}
            ${isRelic && setData["4-Piece Bonus"] ? `<h4>4-Piece Bonus</h4><p>${setData["4-Piece Bonus"]}</p>` : ''}
        </div>`;
    }

    const charactersUsingSet = characterBuilds.filter(char =>
        isOrnament ? char.planetarySetsAll.includes(setName) : char.relicSetsAll.includes(setName)
    );

    // Load or initialize filters
    const cacheKey = `relicFilterState_${setSlug}`;
    const cachedFiltersJson = sessionStorage.getItem(cacheKey);
    let initialFilters = {
        selectedMainStats: { BODY: [], FEET: [], SPHERE: [], ROPE: [] },
        selectedSubStats: [],
        requiredSubstatCount: 1
    };
    if (cachedFiltersJson) {
      try {
        initialFilters = { ...initialFilters, ...JSON.parse(cachedFiltersJson) };
      } catch (e) {
        console.error("Error parsing cached filters:", e);
      } finally {
        sessionStorage.removeItem(cacheKey); // Always clear after attempting to load
      }
    }
    let { selectedMainStats, selectedSubStats, requiredSubstatCount } = initialFilters;
    
    // Update global page info for saving state on navigation
    previousPageInfo = { type: 'relicSet', slug: setSlug, filters: { selectedMainStats, selectedSubStats, requiredSubstatCount }};
    
    const renderStatOptions = (stats, type, piece = null) => stats.map(stat => {
        const usersCount = charactersUsingSet.filter(char => {
            if (type === 'main') {
                return getCharacterPieceStats(char, piece).includes(stat);
            }
            return char.substatsClean.includes(stat);
        }).length;
        const isUnused = usersCount === 0;
        const isActive = piece ? selectedMainStats[piece]?.includes(stat) : selectedSubStats.includes(stat);
        
        return `<button class="stat-option ${type}-stat-option ${isUnused ? 'unused-stat' : ''} ${isActive ? 'active' : ''}" 
                data-stat-type="${type}" ${piece ? `data-piece="${piece}"` : ''} data-value="${stat}"
                title="${stat} - Used by ${usersCount} character(s)" ${isUnused ? 'disabled' : ''}>
            <img class="stat-icon" src="images/game-icon/${slugify(stat)}.webp" alt="${stat} icon">
            <span class="stat-name">${stat}</span>
            <span class="stat-count">${usersCount}</span>
        </button>`;
    }).join('');

    const mainStatPieces = isOrnament ? ["SPHERE", "ROPE"] : ["BODY", "FEET"];
    const mainStatsFilterHtml = mainStatPieces.map(piece => `
      <div class="filter-piece-group" data-piece-type="${piece}">
        <h5>${piece.charAt(0) + piece.slice(1).toLowerCase()}</h5>
        <div class="stat-options-grid">${renderStatOptions(MAIN_STATS_SCHEMA[piece], 'main', piece)}</div>
      </div>`).join('');

    const subStatsFilterHtml = `<div class="stat-options-grid">${renderStatOptions(SUBSTATS_CANONICAL, 'sub')}</div>`;
    
    appContent.innerHTML = `
      <div class="page-container">
          <div class="page-header"><div class="page-title-with-icon"><img src="images/relic/${slugify(setName)}.webp" alt="${setName}" class="page-main-icon"><h2>${setName}</h2></div></div>
          ${setInfoHtml}
          <div class="relic-interactive-filter-area">
              <h3>Stat Usage Analysis</h3>
              <p>Select stats to find characters who benefit from this set with those stats. Stats with 0 are not used by any character with this set.</p>
              <div class="filter-controls-panel">
                  <div class="filter-section"><div class="filter-section-header"><h4>Main Stats</h4><button class="collapse-toggle-btn" aria-expanded="true" aria-controls="main-stats-content">▼</button></div><div class="filter-section-content" id="main-stats-content">${mainStatsFilterHtml}</div></div>
                  <div class="filter-section"><div class="filter-section-header"><h4>Substats</h4><button class="collapse-toggle-btn" aria-expanded="true" aria-controls="sub-stats-content">▼</button></div><div class="filter-section-content" id="sub-stats-content"><div class="substats-logic-toggle"><span>Match at least</span><div class="substat-count-selector"><button class="stepper-btn" data-step="-1" disabled>-</button><span class="stepper-value">1</span><button class="stepper-btn" data-step="1">+</button></div><span>of the selected substats</span></div>${subStatsFilterHtml}</div></div>
                  <button id="reset-filters-btn" class="filter-button">Reset Relic Filters</button>
              </div>
              <div class="filtered-results-section">
                  <div class="filtered-results-header"><h4 id="character-count-display"></h4><button id="character-filter-toggle" class="link-button">Filter Characters ▼</button></div>
                  <div id="relic-page-character-filter-container" style="display: none;">${_renderCharacterFilterBar('relic-page-character-filter-bar')}</div>
                  <div id="filtered-character-list-container" class="item-list-scroll-container character-list"></div>
                  <p id="no-filtered-results-message" style="display:none;">No characters match the selected criteria for this set.</p>
              </div>
          </div>
      </div>`;
      
    const characterListContainer = document.getElementById('filtered-character-list-container');
    const characterCountDisplay = document.getElementById('character-count-display');
    const noResultsMessage = document.getElementById('no-filtered-results-message');
    const filterArea = appContent.querySelector('.relic-interactive-filter-area');
    const substatStepper = filterArea.querySelector('.substat-count-selector');

    const updateStepperState = () => {
        const valueSpan = substatStepper.querySelector('.stepper-value');
        const [minusBtn, plusBtn] = substatStepper.querySelectorAll('.stepper-btn');
        const min = 1;
        const max = Math.max(1, Math.min(4, selectedSubStats.length));
        if (requiredSubstatCount > max) requiredSubstatCount = max;
        valueSpan.textContent = requiredSubstatCount;
        minusBtn.disabled = requiredSubstatCount <= min;
        plusBtn.disabled = requiredSubstatCount >= max;
    };
    
    const applyFiltersAndRenderResults = () => {
        let filteredCharacters = [...charactersUsingSet];

        // Filter by selected Main Stats
        const activeMainStatPieces = Object.keys(selectedMainStats).filter(piece => selectedMainStats[piece].length > 0);
        if (activeMainStatPieces.length > 0) {
            filteredCharacters = filteredCharacters.filter(char => {
                return activeMainStatPieces.every(pieceType => {
                    const charPieceStats = getCharacterPieceStats(char, pieceType);
                    if (!charPieceStats || charPieceStats.length === 0) return false;
                    return selectedMainStats[pieceType].some(selStat => charPieceStats.includes(selStat));
                });
            });
        }

        // Filter by selected Substats
        if (selectedSubStats.length > 0) {
            filteredCharacters = filteredCharacters.filter(char => {
                const charNeededSubstats = char.substatsClean;
                if (charNeededSubstats.length === 0) return false;

                const matchCount = charNeededSubstats.filter(sub => selectedSubStats.includes(sub)).length;

                // If a character needs fewer substats than the filter requires,
                // they are a match only if ALL of their needed substats are selected.
                if (charNeededSubstats.length < requiredSubstatCount) {
                    return matchCount === charNeededSubstats.length;
                }

                // Otherwise, the standard logic applies: the number of matches must meet the requirement.
                return matchCount >= requiredSubstatCount;
            });
        }
      
        // Apply global character attribute filters
        const finalFilteredCharacters = applyCharacterFilters(filteredCharacters);

        characterCountDisplay.textContent = `Showing ${finalFilteredCharacters.length} of ${charactersUsingSet.length} character(s) for this set`;
        
        const hasResults = finalFilteredCharacters.length > 0;
        if (hasResults) {
            characterListContainer.innerHTML = _renderItemsList(finalFilteredCharacters, "character", "Matching Characters", "character-list-icon");
            noResultsMessage.style.display = 'none';
            characterListContainer.style.display = '';
        } else {
            characterListContainer.innerHTML = '';
            noResultsMessage.style.display = 'block';
            characterListContainer.style.display = 'none';
        }
        
        // Update state for persistence on navigation
        if (previousPageInfo.type === 'relicSet') {
          previousPageInfo.filters = { selectedMainStats, selectedSubStats, requiredSubstatCount };
        }
    };

    // Set initial state of the character filter dropdown
    const charFilterContainer = document.getElementById('relic-page-character-filter-container');
    const charFilterToggleBtn = document.getElementById('character-filter-toggle');
    const areCharFiltersActive = Object.values(characterListFilters).some(set => set.size > 0);
    if (areCharFiltersActive) {
        charFilterContainer.style.display = 'block';
        charFilterToggleBtn.textContent = 'Filter Characters ▲';
    }

    filterArea.addEventListener('click', e => {
      const target = e.target;
      let needsRender = false;

      const statBtn = target.closest('button.stat-option:not(:disabled)');
      const resetBtn = target.closest('#reset-filters-btn');
      const collapseTrigger = target.closest('.filter-section-header');
      const stepperBtn = target.closest('.stepper-btn:not(:disabled)');
      const charFilterToggleBtn = target.closest('#character-filter-toggle');
      const charFilterBtn = target.closest('#relic-page-character-filter-bar .filter-option');
      const charFilterResetBtn = target.closest('#relic-page-character-filter-bar .filter-reset-btn');

      if (statBtn) {
          statBtn.classList.toggle('active');
          const { statType, value, piece } = statBtn.dataset;
          const set = (statType === 'main') ? new Set(selectedMainStats[piece]) : new Set(selectedSubStats);
          
          set.has(value) ? set.delete(value) : set.add(value);

          if (statType === 'main') {
              selectedMainStats[piece] = Array.from(set);
          } else {
              selectedSubStats = Array.from(set);
              updateStepperState();
          }
          needsRender = true;
      } else if (resetBtn) {
          selectedMainStats = { BODY: [], FEET: [], SPHERE: [], ROPE: [] };
          selectedSubStats = [];
          requiredSubstatCount = 1;
          filterArea.querySelectorAll('button.stat-option.active').forEach(btn => btn.classList.remove('active'));
          updateStepperState();
          needsRender = true;
      } else if (collapseTrigger) {
          const collapseToggleBtn = collapseTrigger.querySelector('.collapse-toggle-btn');
          const content = document.getElementById(collapseToggleBtn.getAttribute('aria-controls'));
          const isExpanded = collapseToggleBtn.getAttribute('aria-expanded') === 'true';
          collapseToggleBtn.setAttribute('aria-expanded', !isExpanded);
          content.style.display = isExpanded ? 'none' : '';
          collapseToggleBtn.textContent = isExpanded ? '▶' : '▼';
      } else if (stepperBtn) {
          requiredSubstatCount += parseInt(stepperBtn.dataset.step, 10);
          updateStepperState();
          needsRender = true;
      } else if (charFilterToggleBtn) {
          const container = document.getElementById('relic-page-character-filter-container');
          const isHidden = container.style.display === 'none';
          container.style.display = isHidden ? 'block' : 'none';
          charFilterToggleBtn.textContent = isHidden ? 'Filter Characters ▲' : 'Filter Characters ▼';
      } else if (charFilterBtn) {
          const type = charFilterBtn.parentElement.dataset.filterType;
          const value = charFilterBtn.dataset.filterValue;

          if (characterListFilters[type].has(value)) {
              characterListFilters[type].delete(value);
              charFilterBtn.classList.remove('active');
          } else {
              characterListFilters[type].add(value);
              charFilterBtn.classList.add('active');
          }
          needsRender = true;
      } else if (charFilterResetBtn) {
          Object.values(characterListFilters).forEach(set => set.clear());
          document.querySelectorAll('#relic-page-character-filter-bar .filter-option.active').forEach(b => b.classList.remove('active'));
          needsRender = true;
      }
      
      if (needsRender) {
        applyFiltersAndRenderResults();
      }
    });

    // Initial render
    updateStepperState();
    applyFiltersAndRenderResults();
  }


  // --- Search Popup Logic ---
  function openSearchPopup() {
    searchPopup.style.display = "flex";
    universalSearchInput.value = "";
    universalSearchInput.focus();
    document.body.style.overflow = "hidden";
    handleUniversalSearch();
    currentSearchFocusIndex = -1;
  }

  function closeSearchPopup() {
    searchPopup.style.display = "none";
    document.body.style.overflow = "";
    currentSearchFocusIndex = -1;
  }
  
  function updateSearchItemFocus(newIndex) {
      if (searchableListItems.length === 0) return;
      if (currentSearchFocusIndex > -1) {
          searchableListItems[currentSearchFocusIndex].classList.remove("focused-search-item");
      }
      currentSearchFocusIndex = newIndex;
      const item = searchableListItems[currentSearchFocusIndex];
      item.classList.add("focused-search-item");
      item.scrollIntoView({ block: "center" });
  }

  function handleUniversalSearch() {
    const query = universalSearchInput.value.trim().toLowerCase();
    currentSearchFocusIndex = -1;

    if (!query) {
      universalSearchResults.innerHTML = '<p class="search-prompt">Type to start searching.</p>';
      searchableListItems = [];
      return;
    }

    const createResultList = (title, items, type) => {
        if (items.length === 0) return '';
        const listItems = items.map(item => {
            const name = type === 'character' ? item.displayName : item;
            const slug = slugify(type === 'character' ? item.name : item);
            const itemType = type === 'ornament' ? 'ornaments' : `${type}s`;
            const iconPath = type === 'character' ? `character/${slug}` : `relic/${slug}`;
            return `<li><a href="#/${itemType}/${slug}"><img src="images/${iconPath}.webp" alt="" class="item-icon search-result-icon">${name}</a></li>`;
        }).join('');
        return `<h3>${title}</h3><ul class="search-results-list">${listItems}</ul>`;
    };

    const matchingRelics = RELIC_SETS_DATA.filter(name => name.toLowerCase().includes(query)).sort();
    const matchingOrnaments = ORNAMENT_SETS_DATA.filter(name => name.toLowerCase().includes(query)).sort();
    const matchingCharacters = characterBuilds.filter(c => c.name.toLowerCase().includes(query) || c.displayName.toLowerCase().includes(query)).sort((a,b) => a.displayName.localeCompare(b.displayName));

    let html = createResultList('Cavern Relics', matchingRelics, 'relic') +
               createResultList('Planar Ornaments', matchingOrnaments, 'ornament') +
               createResultList('Characters', matchingCharacters, 'character');

    if (!html) {
      universalSearchResults.innerHTML = '<p class="search-prompt">No results found.</p>';
      searchableListItems = [];
    } else {
      universalSearchResults.innerHTML = html;
      searchableListItems = Array.from(universalSearchResults.querySelectorAll(".search-results-list li"));
      universalSearchResults.querySelectorAll("a").forEach(link => link.addEventListener("click", closeSearchPopup));
    }
  }


  // --- Navigation and Routing ---
  function updateActiveNav(currentHash) {
    mainNav.querySelectorAll("a.active, button.active").forEach(el => el.classList.remove("active"));
    const path = currentHash.split('/')[1] || ''; // #/relics/slug -> relics
    const navItem = mainNav.querySelector(`a[data-nav-path="/${path}"]`);
    if(navItem) navItem.classList.add("active");
  }

  function handleRouteChange() {
    // Persist filter state of the previous relic set page before navigating away
    if (previousPageInfo.type === 'relicSet' && previousPageInfo.slug && previousPageInfo.filters) {
      sessionStorage.setItem(`relicFilterState_${previousPageInfo.slug}`, JSON.stringify(previousPageInfo.filters));
    }

    const hash = location.hash || "#/";
    document.querySelector(".loading-container")?.remove(); // Hide loading indicator

    const routes = {
      "#/relics": renderCavernRelicsPage,
      "#/ornaments": renderPlanarOrnamentsPage,
      "#/characters": renderCharactersListPage,
    };
    
    if (routes[hash]) {
      routes[hash]();
    } else if (hash.startsWith("#/characters/")) {
      const charSlug = hash.substring("#/characters/".length);
      const character = characterBuilds.find(c => slugify(c.name) === charSlug);
      renderCharacterPage(character ? character.name : deslugify(charSlug));
    } else if (hash.startsWith("#/ornaments/")) {
      renderRelicSetPage(hash.substring("#/ornaments/".length));
    } else if (hash.startsWith("#/relics/")) {
      renderRelicSetPage(hash.substring("#/relics/".length));
    } else {
      renderHomePage();
    }
    
    updateActiveNav(location.hash);
    window.scrollTo(0, 0);
  }

  // --- Application Initialization ---
  async function initApp() {
    try {
      const [buildDataResponse, relicInfoResponse] = await Promise.all([
        fetch(BUILD_DATA_URL), fetch(RELIC_INFO_URL),
      ]);
      if (!buildDataResponse.ok || !relicInfoResponse.ok) throw new Error(`HTTP error fetching data.`);
      
      const rawBuildData = await buildDataResponse.json();
      relicSetDetailsData = await relicInfoResponse.json();

      const relicIdLookup = new Map(relicSetDetailsData.map(item => [item.Name, item.ID]));
      const tempRelicSets = new Set(), tempOrnamentSets = new Set();
      
      relicSetDetailsData.forEach(item => {
        if (!item.Name) return;
        if (item.Type === "Relic Set") tempRelicSets.add(item.Name);
        else if (item.Type === "Planetary Ornament Set") tempOrnamentSets.add(item.Name);
        
        if (item.Group) {
          item.Group.split(',').map(g => g.trim()).filter(Boolean).forEach(groupName => {
            if (!RELIC_GROUP_MAP.has(groupName)) RELIC_GROUP_MAP.set(groupName, new Set());
            RELIC_GROUP_MAP.get(groupName).add(item.Name);
          });
        }
      });
      
      const sortByIdDesc = (a, b) => (relicIdLookup.get(b) || 0) - (relicIdLookup.get(a) || 0);
      RELIC_SETS_DATA = Array.from(tempRelicSets).sort(sortByIdDesc);
      ORNAMENT_SETS_DATA = Array.from(tempOrnamentSets).sort(sortByIdDesc);
      ALL_KNOWN_SETS_SORTED = [...RELIC_SETS_DATA, ...ORNAMENT_SETS_DATA].sort((a, b) => b.length - a.length);

      ALL_KNOWN_SETS_SORTED.forEach(set => {
        ALL_KNOWN_SETS_SLUG_MAP.set(slugify(set), set);
        ALL_KNOWN_SETS_NORMALIZED_MAP.set(set.toLowerCase().replace(/[^a-z0-9]/g, ""), set);
      });

      processData(rawBuildData);

      characterBuilds.sort((a, b) => (b.Release || 0) - (a.Release || 0) || (a.ID || 0) - (b.ID || 0));

      setupEventListeners();
      handleRouteChange();
    } catch (error) {
      console.error("Initialization failed:", error);
      document.title = `Error - ${SITE_TITLE}`;
      appContent.innerHTML = `<div class="page-container"><p>Error loading application data: ${error.message}</p></div>`;
      document.querySelector(".loading-container")?.remove();
    }
  }

  function setupEventListeners() {
    window.addEventListener("hashchange", handleRouteChange);

    // Search Popup Listeners
    navSearchButton.addEventListener("click", openSearchPopup);
    searchPopup.addEventListener("click", e => { if (e.target === searchPopup) closeSearchPopup(); });
    universalSearchInput.addEventListener("input", handleUniversalSearch);
    universalSearchClearBtn.addEventListener("click", () => {
        if (universalSearchInput.value) {
          universalSearchInput.value = "";
          handleUniversalSearch();
          universalSearchInput.focus();
        } else {
          closeSearchPopup();
        }
    });

    // Global Keyboard Shortcuts
    document.addEventListener("keydown", e => {
      const isSearchActive = searchPopup.style.display === "flex";
      const activeElement = document.activeElement;
      const isTyping = activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA");

      if (isSearchActive) {
        if (e.key === "Escape") closeSearchPopup();
        else if (e.key === "ArrowDown") {
          e.preventDefault();
          const nextIndex = (currentSearchFocusIndex + 1) % searchableListItems.length;
          updateSearchItemFocus(nextIndex);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          const prevIndex = (currentSearchFocusIndex - 1 + searchableListItems.length) % searchableListItems.length;
          const lastIndex = searchableListItems.length - 1;
          updateSearchItemFocus(currentSearchFocusIndex === -1 ? lastIndex : prevIndex);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const targetIndex = currentSearchFocusIndex === -1 ? 0 : currentSearchFocusIndex;
          searchableListItems[targetIndex]?.querySelector("a")?.click();
        }
      } else if (e.key === "/" && !isTyping) {
        e.preventDefault();
        openSearchPopup();
      }
    });
  }

  // --- Start the Application ---
  initApp();

})();