// --- START OF FILE script.js ---

(function () {
  "use strict";

  const BUILD_DATA_URL = "data/characters.json";
  const RELIC_INFO_URL = "data/relics.json";
  const appContent = document.getElementById("app-content");
  const siteTitle = "Honkai: Star Rail Relic Helper";

  // --- Dynamic Data (will be populated from RELIC_INFO_URL) ---
  let RELIC_SETS_DATA = []; // Cavern Relics, sorted by ID desc
  let ORNAMENT_SETS_DATA = []; // Planar Ornaments, sorted by ID desc
  let ALL_KNOWN_SETS_SORTED = []; // All set names, sorted by string length desc (for parsing)
  let relicSetDetailsData = []; // Raw relic info from relics.json

  // Precomputed maps for faster lookups, populated in initApp
  let ALL_KNOWN_SETS_SLUG_MAP = new Map(); // Map<slug, originalSetName>
  let ALL_KNOWN_SETS_NORMALIZED_MAP = new Map(); // Map<normalizedName, originalSetName>

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
  // Precompute for parseSubstats efficiency
  const SORTED_SUBSTATS_CANONICAL_BY_LENGTH = [...SUBSTATS_CANONICAL].sort(
    (a, b) => b.length - a.length,
  );
  const SUBSTATS_CANONICAL_LOWER = SUBSTATS_CANONICAL.map((s) =>
    s.toLowerCase(),
  );

  const SUBSTAT_ALIASES = { // Keys should be lowercase for consistent matching
    hp: "HP%", def: "DEF%", atk: "ATK%", ehr: "Effect Hit Rate",
    "ehr%": "Effect Hit Rate", "eff res": "Effect RES", "eff res%": "Effect RES",
    spd: "Speed", "crit rate": "CRIT Rate", "crit dmg": "CRIT DMG",
    "break effect%": "Break Effect",
  };

  let characterBuilds = []; // Processed character build data, sorted
  let allCharacters = []; // Character names, derived from sorted characterBuilds

  // DOM Elements
  const searchPopup = document.getElementById("search-popup");
  const universalSearchInput = document.getElementById("universal-search-input");
  const universalSearchResults = document.getElementById("universal-search-results");
  const universalSearchClearBtn = document.getElementById("universal-search-clear-btn");
  const navSearchButton = document.getElementById("nav-search-button");
  const mainNav = document.getElementById("main-nav");

  // Search state
  let searchableListItems = [];
  let currentSearchFocusIndex = -1;
  let lastUniversalSearchQueryValue = ""; // Remembers search query for current session

  // --- Utility Functions ---
  function slugify(text) {
    if (!text) return "";
    return text.toString().toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]+/g, "")
      .replace(/--+/g, "-");
  }

  function deslugify(slug) {
    if (!slug) return "";
    return slug.replace(/-/g, " ")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

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
    if (ALL_KNOWN_SETS_SLUG_MAP.has(slugify(potentialName))) {
        return potentialName;
    }
    return potentialName;
  }

  // --- Data Parsing ---
  function parseSetListString(setString) {
    if (!setString || typeof setString !== "string") return [];
    const foundSets = [];
    let remainingString = setString.trim();

    while (remainingString.length > 0) {
      let matched = false;
      for (const setName of ALL_KNOWN_SETS_SORTED) { // Greedy match from longest names
        if (remainingString.startsWith(setName)) {
          foundSets.push(setName);
          remainingString = remainingString.substring(setName.length).trim();
          if (remainingString.startsWith(",")) {
            remainingString = remainingString.substring(1).trim();
          }
          matched = true;
          break;
        }
      }
      if (!matched) break;
    }
    return foundSets;
  }

  function parseSubstats(substatStr) {
    if (!substatStr) return { clean: [], comment: "" };

    const originalComment = substatStr;
    let tempStr = substatStr.replace(/\([^)]*\)|\[[^\]]*\]/g, "").trim();
    const parts = tempStr.split(/[>≥=]+/);
    const cleanSubstats = [];
    const seenSubstats = new Set();

    for (const part of parts) {
      let potentialStat = part.trim().toLowerCase();
      if (!potentialStat) continue;

      let matchedCanonicalStat = null;

      if (SUBSTAT_ALIASES[potentialStat]) {
        matchedCanonicalStat = SUBSTAT_ALIASES[potentialStat];
      } else {
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
    return { clean: cleanSubstats, comment: originalComment };
  }

  // Helper to aggregate sets from multiple relic/planetary slots
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

  function processData(jsonData) {
    characterBuilds = jsonData.map((item) => {
      const substatsParsed = parseSubstats(item.Substats);

      // Aggregate relic and planetary sets as "Concat" fields are removed
      const allRelicSets = aggregateAllSets(item, "Relic");
      const allPlanetarySets = aggregateAllSets(item, "Planetary");

      return {
        name: item.Name,
        ID: item.ID,
        Release: item.Release,
        body: item.Body ? item.Body.split(",").map((s) => s.trim()) : [],
        feet: item.Feet ? item.Feet.split(",").map((s) => s.trim()) : [],
        // Store aggregated sets; these are used by renderRelicSetPage
        relicSetsAll: allRelicSets,
        planetarySetsAll: allPlanetarySets,
        // Keep individual relic options for display on character page
        relic1: parseSetListString(item.Relic1),
        relic2: parseSetListString(item.Relic2),
        relic3: parseSetListString(item.Relic3),
        relic4: parseSetListString(item.Relic4),
        relic5: parseSetListString(item.Relic5),
        planarSphere: item["Planar Sphere"]
          ? item["Planar Sphere"].split(",").map((s) => s.trim())
          : [],
        linkRope: item["Link Rope"]
          ? item["Link Rope"].split(",").map((s) => s.trim())
          : [],
        // Keep individual planetary options for display on character page
        planetary1: parseSetListString(item.Planetary1),
        planetary2: parseSetListString(item.Planetary2),
        planetary3: parseSetListString(item.Planetary3),
        planetary4: parseSetListString(item.Planetary4),
        planetary5: parseSetListString(item.Planetary5),
        substatsClean: substatsParsed.clean,
        substatsComment: substatsParsed.comment,
      };
    });
    // Sorting of characterBuilds and population of allCharacters happens in initApp
  }

  // --- Rendering Functions ---

  function _renderItemsList(items, itemType, listTitle, itemClass = "") {
    let listHtml = "";
    if (items.length > 0) {
      listHtml = items.map((name) => {
          const slug = slugify(name);
          let href = "", imgSrc = "";
          if (itemType === "cavern-relic") {
            href = `#/relics/${slug}`; imgSrc = `images/relic/${slug}.webp`;
          } else if (itemType === "planar-ornament") {
            href = `#/ornaments/${slug}`; imgSrc = `images/relic/${slug}.webp`;
          } else if (itemType === "character") {
            href = `#/characters/${slug}`; imgSrc = `images/character/${slug}.webp`;
          }
          return `
            <li>
                <a href="${href}">
                    <img src="${imgSrc}" alt="" class="item-icon ${itemClass}" loading="lazy">
                    ${name}
                </a>
            </li>`;
        }).join("");
    } else {
      listHtml = `<li>No ${listTitle.toLowerCase()} found.</li>`;
    }
    return `<ul class="content-list item-grid-list">${listHtml}</ul>`;
  }

  function renderHomePage() {
    document.title = siteTitle;
    appContent.innerHTML = `
      <div class="page-container home-page-layout">
          <section class="home-section">
              <h2>Cavern Relics</h2>
              <div class="item-list-scroll-container">
                  ${_renderItemsList(RELIC_SETS_DATA, "cavern-relic", "Cavern Relics", "relic-list-icon")}
              </div>
          </section>
          <section class="home-section">
              <h2>Planar Ornaments</h2>
              <div class="item-list-scroll-container">
                  ${_renderItemsList(ORNAMENT_SETS_DATA, "planar-ornament", "Planar Ornaments", "relic-list-icon")}
              </div>
          </section>
          <section class="home-section">
              <h2>Characters</h2>
              <div class="item-list-scroll-container">
                  ${_renderItemsList(allCharacters, "character", "Characters", "character-list-icon")}
              </div>
          </section>
      </div>`;
  }

  function renderCavernRelicsPage() {
    document.title = `Cavern Relics - ${siteTitle}`;
    appContent.innerHTML = `
      <div class="page-container">
          <div class="page-header simple-header"><h2>Cavern Relics</h2></div>
          <div class="item-list-scroll-container full-page-list">
              ${_renderItemsList(RELIC_SETS_DATA, "cavern-relic", "Cavern Relics", "relic-list-icon")}
          </div>
      </div>`;
  }

  function renderPlanarOrnamentsPage() {
    document.title = `Planar Ornaments - ${siteTitle}`;
    appContent.innerHTML = `
      <div class="page-container">
           <div class="page-header simple-header"><h2>Planar Ornaments</h2></div>
          <div class="item-list-scroll-container full-page-list">
              ${_renderItemsList(ORNAMENT_SETS_DATA, "planar-ornament", "Planar Ornaments", "relic-list-icon")}
          </div>
      </div>`;
  }

  function renderCharactersListPage() {
    document.title = `Characters - ${siteTitle}`;
    appContent.innerHTML = `
      <div class="page-container">
          <div class="page-header simple-header"><h2>Characters</h2></div>
          <div class="item-list-scroll-container full-page-list">
              ${_renderItemsList(allCharacters, "character", "Characters", "character-list-icon")}
          </div>
      </div>`;
  }

  function renderCharacterPage(characterName) {
    document.title = `${characterName} - ${siteTitle}`;
    const character = characterBuilds.find((c) => c.name === characterName);
    if (!character) {
      appContent.innerHTML = `<div class="page-container"><p>Character not found: ${characterName}</p><p><a href="#">Go Home</a></p></div>`;
      return;
    }

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

    // Relic/Ornament recommendations still come from individual relic1-5, planetary1-5 fields
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
                  <h2>${character.name} Recommended Builds</h2>
              </div>
          </div>
          <div class="build-section">
              <h3>Cavern Relics</h3>
              <div class="build-grid build-relics">
                  ${relicRecommendations.length > 0
                    ? relicRecommendations.map((relicSetOption, index) => {
                        const isTwoPlusTwo = relicSetOption.length > 1 &&
                                           relicSetOption.every(setName => RELIC_SETS_DATA.includes(setName));
                        const optionTitle = `Option ${index + 1}${isTwoPlusTwo && relicSetOption.length === 2 ? " (2 pcs + 2 pcs)" : ""}`;
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
  }

  function renderRelicSetPage(setSlug) { // isOrnamentContext no longer needed as we check both global lists
    const setName = findOriginalSetName(setSlug);
    document.title = `${setName} - ${siteTitle}`;

    const isActualOrnament = ORNAMENT_SETS_DATA.includes(setName);
    const isActualRelic = RELIC_SETS_DATA.includes(setName);

    if (!isActualOrnament && !isActualRelic) {
      appContent.innerHTML = `<div class="page-container"><p>Relic set not found: ${setName}</p><p><a href="#">Go Home</a></p></div>`;
      return;
    }

    const setData = relicSetDetailsData.find((s) => s.Name === setName);
    let setInfoHtml = "";
    if (setData) {
      setInfoHtml += `<div class="relic-set-bonuses">`;
      if (setData["2-Piece Bonus"]) {
        setInfoHtml += `<h4>2-Piece Bonus</h4><p>${setData["2-Piece Bonus"]}</p>`;
      }
      if (setData["4-Piece Bonus"] && setData["4-Piece Bonus"].trim() !== "" && isActualRelic) {
        setInfoHtml += `<h4>4-Piece Bonus</h4><p>${setData["4-Piece Bonus"]}</p>`;
      }
      setInfoHtml += `</div>`;
    }
    
    // Use the aggregated set lists: relicSetsAll or planetarySetsAll
    const charactersUsingSet = characterBuilds.filter(char => {
      return isActualOrnament ?
             char.planetarySetsAll.includes(setName) :
             char.relicSetsAll.includes(setName);
    }); // These characters are already sorted by Release(desc)/ID(asc)

    const pieceOrder = isActualOrnament ? ["SPHERE", "ROPE"] : ["BODY", "FEET"];
    let mainStatHtml = '<table class="analysis-table"><thead><tr><th>Main Stat</th><th>Used By</th></tr></thead><tbody>';

    for (const piece of pieceOrder) {
      const possibleMainStats = MAIN_STATS_SCHEMA[piece];
      let pieceStatsHtml = "";

      for (const stat of possibleMainStats) {
        const users = charactersUsingSet.filter(char => {
          let charPieceStats = [];
          if (piece === "BODY") charPieceStats = char.body;
          else if (piece === "FEET") charPieceStats = char.feet;
          else if (piece === "SPHERE") charPieceStats = char.planarSphere;
          else if (piece === "ROPE") charPieceStats = char.linkRope;
          return charPieceStats.includes(stat);
        });

        const userCount = users.length;
        const statClass = userCount > 0 ? "stat-used" : "stat-unused";
        const charListId = `mainstat-chars-${slugify(piece)}-${slugify(stat)}`;
        const toggleText = userCount > 0 ? `${userCount} character${userCount !== 1 ? "s" : ""}` : `0 characters`;
        const toggleClass = userCount > 0 ? "" : "no-users";

        pieceStatsHtml += `<tr><td><span class="stat-value ${statClass}">${stat}</span></td><td>`;
        if (userCount > 0) {
          pieceStatsHtml += `<span class="char-count-toggle ${toggleClass}" data-target-id="${charListId}">${toggleText}</span>`;
          pieceStatsHtml += `<div id="${charListId}" class="character-list-tooltip" style="display:none;">
            ${users.map(u => `
                <a href="#/characters/${slugify(u.name)}" class="char-tooltip-link">
                    <img src="images/character/${slugify(u.name)}.webp" alt="" class="item-icon tooltip-icon" loading="lazy">
                    ${u.name}
                </a>`).join("")}
            </div>`;
        } else {
          pieceStatsHtml += `<span class="char-count-toggle ${toggleClass}">${toggleText}</span>`;
        }
        pieceStatsHtml += "</td></tr>";
      }
      if (possibleMainStats.length > 0) {
        mainStatHtml += `<tr><td class="main-stat-type" colspan="2">${piece.charAt(0) + piece.slice(1).toLowerCase()}</td></tr>${pieceStatsHtml}`;
      }
    }
    mainStatHtml += "</tbody></table>";

    const relevantSubstatsMap = new Map();
    charactersUsingSet.forEach(char => {
      char.substatsClean.forEach(sub => {
        if (!relevantSubstatsMap.has(sub)) {
          relevantSubstatsMap.set(sub, []);
        }
        relevantSubstatsMap.get(sub).push(char); // Store sorted character objects
      });
    });

    let substatSectionHtml = "<p>This shows which substats are generally prioritized by characters who equip this set.</p>";
    substatSectionHtml += '<table class="analysis-table"><thead><tr><th>Substat</th><th>Prioritized By</th></tr></thead><tbody>';
    
    for (const stat of SUBSTATS_CANONICAL) { // Iterate to maintain consistent order
      const usersArrayWithDetails = relevantSubstatsMap.get(stat) || [];
      const userCount = usersArrayWithDetails.length;
      const statClass = userCount > 0 ? "stat-used" : "stat-unused";
      const charListId = `substat-chars-${slugify(stat)}`;
      const toggleText = userCount > 0 ? `${userCount} character${userCount !== 1 ? "s" : ""}` : `0 characters`;
      const toggleClass = userCount > 0 ? "" : "no-users";

      substatSectionHtml += `<tr>
          <td><span class="stat-value ${statClass}">${stat}</span></td>
          <td>`;
      if (userCount > 0) {
        substatSectionHtml += `<span class="char-count-toggle ${toggleClass}" data-target-id="${charListId}">${toggleText}</span>
            <div id="${charListId}" class="character-list-tooltip" style="display:none;">
                ${usersArrayWithDetails.map(u => `
                    <a href="#/characters/${slugify(u.name)}" class="char-tooltip-link">
                        <img src="images/character/${slugify(u.name)}.webp" alt="" class="item-icon tooltip-icon" loading="lazy">
                        ${u.name}
                    </a>`).join("")}
            </div>`;
      } else {
        substatSectionHtml += `<span class="char-count-toggle ${toggleClass}">${toggleText}</span>`;
      }
      substatSectionHtml += `</td></tr>`;
    }
    substatSectionHtml += "</tbody></table>";

    appContent.innerHTML = `
      <div class="page-container">
          <div class="page-header">
               <div class="page-title-with-icon">
                  <img src="images/relic/${slugify(setName)}.webp" alt="${setName}" class="page-main-icon" loading="lazy">
                  <h2>${setName}</h2>
              </div>
          </div>
          ${setInfoHtml}
          <div class="relic-info-section">
              <h3>Main Stat Usage Analysis</h3>
              <p>This shows which main stats are generally useful for characters who equip this set.</p>
              ${mainStatHtml}
          </div>
          <div class="relic-info-section">
              <h3>Substat Priority Analysis</h3>
              ${substatSectionHtml}
          </div>
      </div>`;
  }

  // --- Search Popup Logic ---
  function openSearchPopup() {
    searchPopup.style.display = "flex";
    universalSearchInput.value = lastUniversalSearchQueryValue;
    universalSearchInput.focus();
    document.body.style.overflow = "hidden";
    handleUniversalSearch();
    currentSearchFocusIndex = -1;
    removeSearchItemFocus();
  }

  function closeSearchPopup() {
    searchPopup.style.display = "none";
    universalSearchResults.innerHTML = '<p class="search-prompt">Type to start searching.</p>';
    document.body.style.overflow = "";
    currentSearchFocusIndex = -1;
    searchableListItems = [];
  }

  function removeSearchItemFocus() {
    searchableListItems.forEach((item) => item.classList.remove("focused-search-item"));
  }

  function addSearchItemFocus(index) {
    removeSearchItemFocus();
    if (searchableListItems[index]) {
      searchableListItems[index].classList.add("focused-search-item");
      searchableListItems[index].scrollIntoView({ block: "nearest", inline: "nearest" });
      currentSearchFocusIndex = index;
    }
  }

  function handleUniversalSearch() {
    const currentInputValue = universalSearchInput.value;
    lastUniversalSearchQueryValue = currentInputValue;
    const query = currentInputValue.trim().toLowerCase();

    currentSearchFocusIndex = -1;
    removeSearchItemFocus();

    if (!query) {
      universalSearchResults.innerHTML = '<p class="search-prompt">Type to start searching.</p>';
      universalSearchClearBtn.style.display = "none";
      searchableListItems = [];
      return;
    }
    universalSearchClearBtn.style.display = "inline-block";

    let html = "";
    const matchingRelics = RELIC_SETS_DATA
      .filter((name) => name.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b));
    if (matchingRelics.length > 0) {
      html += '<h3>Cavern Relics</h3><ul class="search-results-list">';
      matchingRelics.forEach((name) => {
        const slug = slugify(name);
        html += `<li><a href="#/relics/${slug}" tabindex="-1"><img src="images/relic/${slug}.webp" alt="" class="item-icon search-result-icon" loading="lazy">${name}</a></li>`;
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
        html += `<li><a href="#/ornaments/${slug}" tabindex="-1"><img src="images/relic/${slug}.webp" alt="" class="item-icon search-result-icon" loading="lazy">${name}</a></li>`;
      });
      html += "</ul>";
    }

    const matchingCharacters = [...allCharacters]
      .filter((name) => name.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b));
    if (matchingCharacters.length > 0) {
      html += '<h3>Characters</h3><ul class="search-results-list">';
      matchingCharacters.forEach((name) => {
        const slug = slugify(name);
        html += `<li><a href="#/characters/${slug}" tabindex="-1"><img src="images/character/${slug}.webp" alt="" class="item-icon search-result-icon" loading="lazy">${name}</a></li>`;
      });
      html += "</ul>";
    }

    if (!html) {
      universalSearchResults.innerHTML = "<p>No results found.</p>";
      searchableListItems = [];
    } else {
      universalSearchResults.innerHTML = html;
      searchableListItems = Array.from(universalSearchResults.querySelectorAll(".search-results-list li"));
    }

    universalSearchResults.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeSearchPopup);
    });
  }

  // --- Navigation Update ---
  function updateActiveNav(currentHash) {
    const navLinks = mainNav.querySelectorAll("a, button");
    navLinks.forEach((link) => link.classList.remove("active"));

    let activeLink;
    if (currentHash.startsWith("#/relics") && !currentHash.includes("/", "#/relics".length + 1)) {
      activeLink = mainNav.querySelector('a[data-nav-path="/relics"]');
    } else if (currentHash.startsWith("#/ornaments") && !currentHash.includes("/", "#/ornaments".length + 1)) {
      activeLink = mainNav.querySelector('a[data-nav-path="/ornaments"]');
    } else if (currentHash.startsWith("#/characters") && !currentHash.includes("/", "#/characters".length + 1)) {
      activeLink = mainNav.querySelector('a[data-nav-path="/characters"]');
    } else if (currentHash === "#/" || currentHash === "") {
      activeLink = mainNav.querySelector('a[data-nav-path="/"]');
    }

    if (activeLink) activeLink.classList.add("active");
  }

  // --- Router ---
  function handleRouteChange() {
    const hash = location.hash;
    const loadingContainer = document.querySelector(".loading-container");
    if (loadingContainer) loadingContainer.style.display = "none";

    if (hash === "#/relics") renderCavernRelicsPage();
    else if (hash === "#/ornaments") renderPlanarOrnamentsPage();
    else if (hash === "#/characters") renderCharactersListPage();
    else if (hash.startsWith("#/characters/")) {
      const charSlug = hash.substring("#/characters/".length);
      const charName = allCharacters.find(name => slugify(name) === charSlug) || findOriginalSetName(charSlug);
      renderCharacterPage(charName);
    } else if (hash.startsWith("#/ornaments/")) {
      const ornamentSlug = hash.substring("#/ornaments/".length);
      renderRelicSetPage(ornamentSlug);
    } else if (hash.startsWith("#/relics/")) {
      const relicSlug = hash.substring("#/relics/".length);
      renderRelicSetPage(relicSlug);
    } else {
      renderHomePage();
    }
    updateActiveNav(hash);
    window.scrollTo(0, 0);
  }

  // --- Initialization ---
  async function initApp() {
    try {
      const [buildDataResponse, relicInfoResponse] = await Promise.all([
        fetch(BUILD_DATA_URL), fetch(RELIC_INFO_URL),
      ]);

      if (!buildDataResponse.ok) throw new Error(`HTTP error ${buildDataResponse.status} fetching BUILD_DATA_URL`);
      if (!relicInfoResponse.ok) throw new Error(`HTTP error ${relicInfoResponse.status} fetching RELIC_INFO_URL`);

      const rawBuildData = await buildDataResponse.json();
      relicSetDetailsData = await relicInfoResponse.json();

      const relicIdLookup = new Map(relicSetDetailsData.map(item => [item.Name, item.ID]));
      const tempRelicSets = new Set(), tempOrnamentSets = new Set();

      relicSetDetailsData.forEach((item) => {
        if (item.Name && typeof item.Name === "string") {
          if (item.Type === "Relic Set") tempRelicSets.add(item.Name);
          else if (item.Type === "Planetary Ornament Set") tempOrnamentSets.add(item.Name);
        }
      });
      RELIC_SETS_DATA = Array.from(tempRelicSets).sort((a, b) => (relicIdLookup.get(b) || 0) - (relicIdLookup.get(a) || 0));
      ORNAMENT_SETS_DATA = Array.from(tempOrnamentSets).sort((a, b) => (relicIdLookup.get(b) || 0) - (relicIdLookup.get(a) || 0));
      
      ALL_KNOWN_SETS_SORTED = [...RELIC_SETS_DATA, ...ORNAMENT_SETS_DATA].sort((a, b) => b.length - a.length);

      ALL_KNOWN_SETS_SORTED.forEach(set => {
          ALL_KNOWN_SETS_SLUG_MAP.set(slugify(set), set);
          ALL_KNOWN_SETS_NORMALIZED_MAP.set(set.toLowerCase().replace(/[^a-z0-9]/g, ""), set);
      });
      
      processData(rawBuildData);

      characterBuilds.sort((a, b) => {
        if (b.Release !== a.Release) return (b.Release || 0) - (a.Release || 0);
        return (a.ID || 0) - (b.ID || 0);
      });
      allCharacters = characterBuilds.map((c) => c.name);

      // Event delegation for character list toggles
      appContent.addEventListener("click", function (event) {
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

      // Search popup event listeners
      navSearchButton.addEventListener("click", openSearchPopup);
      searchPopup.addEventListener("click", (event) => {
        if (event.target === searchPopup) closeSearchPopup();
      });
      universalSearchInput.addEventListener("input", handleUniversalSearch);
      universalSearchInput.addEventListener("focus", () => {
        currentSearchFocusIndex = -1; removeSearchItemFocus();
      });
      universalSearchClearBtn.addEventListener("click", () => {
        if (universalSearchInput.value) {
          universalSearchInput.value = "";
          lastUniversalSearchQueryValue = "";
          handleUniversalSearch();
          universalSearchInput.focus();
        } else {
          closeSearchPopup();
        }
      });
      universalSearchClearBtn.style.display = "none"; // Initially hidden

      // Global keydown listeners
      document.addEventListener("keydown", (event) => {
        if (searchPopup.style.display === "flex") {
          if (event.key === "Escape") closeSearchPopup();
          else if (event.key === "ArrowDown") {
            event.preventDefault();
            if (searchableListItems.length > 0) {
              currentSearchFocusIndex = (currentSearchFocusIndex + 1) % searchableListItems.length;
              addSearchItemFocus(currentSearchFocusIndex);
            }
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (searchableListItems.length > 0) {
              currentSearchFocusIndex = (currentSearchFocusIndex - 1 + searchableListItems.length) % searchableListItems.length;
              addSearchItemFocus(currentSearchFocusIndex);
            }
          } else if (event.key === "Enter") {
            if (currentSearchFocusIndex !== -1 && searchableListItems[currentSearchFocusIndex]) {
              event.preventDefault();
              const linkToClick = searchableListItems[currentSearchFocusIndex].querySelector("a");
              if (linkToClick) linkToClick.click();
            }
          }
        } else {
          if (event.key === "/") {
            const activeElement = document.activeElement;
            const isTyping = activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable);
            if (!isTyping) {
              event.preventDefault(); openSearchPopup();
            }
          }
        }
      });

      handleRouteChange(); // Initial route handling
    } catch (error) {
      console.error("Initialization failed:", error);
      document.title = `Error - ${siteTitle}`;
      appContent.innerHTML = `<div class="page-container"><p>Error loading application data. Details: ${error.message}</p></div>`;
    }
  }

  window.addEventListener("hashchange", handleRouteChange);
  initApp();
})();
// --- END OF FILE script.js ---