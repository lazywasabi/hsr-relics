(function () {
  "use strict";

  const BUILD_DATA_URL = "data/characters.json";
  const RELIC_INFO_URL = "data/relics.json";
  const appContent = document.getElementById("app-content");
  const siteTitle = "Honkai: Star Rail Relic Helper";

  // --- Dynamic Data (will be populated from RELIC_INFO_URL) ---
  let RELIC_SETS_DATA = []; // Cavern Relics
  let ORNAMENT_SETS_DATA = []; // Planar Ornaments
  let ALL_KNOWN_SETS_SORTED = [];
  let relicSetDetailsData = []; // To store fetched JSON data for relic set bonuses

  // --- Static Schemas & Aliases ---
  const MAIN_STATS_SCHEMA = {
    HEAD: ["HP"],
    HANDS: ["ATK"],
    BODY: [
      "HP%",
      "DEF%",
      "ATK%",
      "CRIT Rate",
      "CRIT DMG",
      "Effect HIT Rate",
      "Outgoing Healing",
    ],
    FEET: ["HP%", "DEF%", "ATK%", "Speed"],
    SPHERE: [
      "HP%",
      "DEF%",
      "ATK%",
      "Physical DMG",
      "Fire DMG",
      "Ice DMG",
      "Wind DMG",
      "Lightning DMG",
      "Quantum DMG",
      "Imaginary DMG",
    ],
    ROPE: ["HP%", "DEF%", "ATK%", "Break Effect", "Energy Regen Rate"],
  };

  const SUBSTATS_CANONICAL = [
    "HP",
    "DEF",
    "ATK",
    "HP%",
    "DEF%",
    "ATK%",
    "Speed",
    "CRIT Rate",
    "CRIT DMG",
    "Break Effect",
    "Effect Hit Rate",
    "Effect RES",
  ];
  const SUBSTAT_ALIASES = {
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

  let characterBuilds = [];
  let allCharacters = [];

  // DOM Elements for Search Popup and Nav
  const searchPopup = document.getElementById("search-popup");
  const searchPopupContent = document.getElementById("search-popup-content");
  const universalSearchInput = document.getElementById(
    "universal-search-input",
  );
  const universalSearchResults = document.getElementById(
    "universal-search-results",
  );
  const universalSearchClearBtn = document.getElementById(
    "universal-search-clear-btn",
  );
  const navSearchButton = document.getElementById("nav-search-button");
  const mainNav = document.getElementById("main-nav");

  // Search keyboard navigation state
  let searchableListItems = [];
  let currentSearchFocusIndex = -1; // -1 means search input is focused for navigation purposes

  // For Requirement 2: Remember Search Query (Session Only)
  let lastUniversalSearchQueryValue = "";

  // --- Utility Functions ---
  function slugify(text) {
    if (!text) return "";
    return text
      .toString()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]+/g, "")
      .replace(/--+/g, "-");
  }

  function findOriginalSetName(slug) {
    if (!slug) return "";
    const searchName = slug.toLowerCase().replace(/-/g, "");
    for (const set of ALL_KNOWN_SETS_SORTED) {
      if (set.toLowerCase().replace(/[^a-z0-9]/g, "") === searchName) {
        return set;
      }
    }
    const potentialName = deslugify(slug);
    if (ALL_KNOWN_SETS_SORTED.includes(potentialName)) return potentialName;

    for (const set of ALL_KNOWN_SETS_SORTED) {
      if (slugify(set) === slug) {
        return set;
      }
    }
    return deslugify(slug);
  }

  function deslugify(slug) {
    if (!slug) return "";
    return slug
      .replace(/-/g, " ")
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  // --- Data Parsing ---
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
          break;
        }
      }
      if (!matched) {
        break;
      }
    }
    return foundSets;
  }

  function parseSubstats(substatStr) {
    if (!substatStr)
      return {
        clean: [],
        comment: "",
      };
    const originalComment = substatStr;
    let tempStr = substatStr;

    tempStr = tempStr.replace(/\([^)]*\)/g, "");
    tempStr = tempStr.replace(/\[[^\]]*\]/g, "");

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
        for (const canonical of SUBSTATS_CANONICAL) {
          if (canonical.toLowerCase() === potentialStat) {
            matchedCanonicalStat = canonical;
            break;
          }
        }
      }

      if (!matchedCanonicalStat) {
        const sortedCanonicals = [...SUBSTATS_CANONICAL].sort(
          (a, b) => b.length - a.length,
        );
        for (const canonical of sortedCanonicals) {
          if (potentialStat.includes(canonical.toLowerCase())) {
            let aliasFound = false;
            for (const [alias, cName] of Object.entries(SUBSTAT_ALIASES)) {
              if (cName === canonical && potentialStat.includes(alias)) {
                matchedCanonicalStat = canonical;
                aliasFound = true;
                break;
              }
            }
            if (
              !aliasFound &&
              SUBSTATS_CANONICAL.map((s) => s.toLowerCase()).includes(
                potentialStat,
              )
            ) {
              matchedCanonicalStat = SUBSTATS_CANONICAL.find(
                (s) => s.toLowerCase() === potentialStat,
              );
            } else if (!aliasFound) {
              matchedCanonicalStat = canonical;
            }
            if (matchedCanonicalStat) break;
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
      comment: originalComment,
    };
  }

  function processData(jsonData) {
    characterBuilds = jsonData.map((item) => {
      const substatsParsed = parseSubstats(item.Substats);
      return {
        name: item.Name,
        ID: item.ID,
        Release: item.Release, // <<< ADD THIS LINE
        body: item.Body ? item.Body.split(",").map((s) => s.trim()) : [],
        feet: item.Feet ? item.Feet.split(",").map((s) => s.trim()) : [],
        relicSetConcat: parseSetListString(item["Relic Set Concat"]),
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
        planetarySetConcat: parseSetListString(item["Planetary Set Concat"]),
        planetary1: parseSetListString(item.Planetary1),
        planetary2: parseSetListString(item.Planetary2),
        planetary3: parseSetListString(item.Planetary3),
        planetary4: parseSetListString(item.Planetary4),
        planetary5: parseSetListString(item.Planetary5),
        substatsClean: substatsParsed.clean,
        substatsComment: substatsParsed.comment,
      };
    });
    // allCharacters will be populated and sorted in initApp after characterBuilds is sorted
  }

  // --- Rendering Functions ---

  function _renderItemsList(items, itemType, listTitle, itemClass = "") {
    let listHtml = "";
    if (items.length > 0) {
      listHtml = items
        .map((name) => {
          const slug = slugify(name);
          let href = "";
          let imgSrc = "";
          if (itemType === "cavern-relic") {
            href = `#/relics/${slug}`;
            imgSrc = `images/relic/${slug}.webp`;
          } else if (itemType === "planar-ornament") {
            href = `#/ornaments/${slug}`;
            imgSrc = `images/relic/${slug}.webp`;
          } else if (itemType === "character") {
            href = `#/characters/${slug}`;
            imgSrc = `images/character/${slug}.webp`;
          }
          return `
                    <li>
                        <a href="${href}">
                            <img src="${imgSrc}" alt="" class="item-icon ${itemClass}" loading="lazy">
                            ${name}
                        </a>
                    </li>`;
        })
        .join("");
    } else {
      listHtml = `<li>No ${listTitle.toLowerCase()} found.</li>`;
    }
    return `<ul class="content-list item-grid-list">${listHtml}</ul>`;
  }

  function renderHomePage() {
    document.title = siteTitle;
    // Lists will be ID-sorted due to changes in initApp
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
            </div>
        `;
  }

  function renderCavernRelicsPage() {
    document.title = `Cavern Relics - ${siteTitle}`;
    // RELIC_SETS_DATA is ID-sorted
    appContent.innerHTML = `
            <div class="page-container">
                <div class="page-header simple-header">
                    <h2>Cavern Relics</h2>
                </div>
                <div class="item-list-scroll-container full-page-list">
                    ${_renderItemsList(RELIC_SETS_DATA, "cavern-relic", "Cavern Relics", "relic-list-icon")}
                </div>
            </div>
        `;
  }

  function renderPlanarOrnamentsPage() {
    document.title = `Planar Ornaments - ${siteTitle}`;
    // ORNAMENT_SETS_DATA is ID-sorted
    appContent.innerHTML = `
            <div class="page-container">
                 <div class="page-header simple-header">
                    <h2>Planar Ornaments</h2>
                </div>
                <div class="item-list-scroll-container full-page-list">
                    ${_renderItemsList(ORNAMENT_SETS_DATA, "planar-ornament", "Planar Ornaments", "relic-list-icon")}
                </div>
            </div>
        `;
  }

  function renderCharactersListPage() {
    document.title = `Characters - ${siteTitle}`;
    // allCharacters is ID-sorted
    appContent.innerHTML = `
            <div class="page-container">
                <div class="page-header simple-header">
                    <h2>Characters</h2>
                </div>
                <div class="item-list-scroll-container full-page-list">
                    ${_renderItemsList(allCharacters, "character", "Characters", "character-list-icon")}
                </div>
            </div>
        `;
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
      // Order of sets in build options is preserved as per data
      return sets
        .map((s) => {
          const isOrnament = ORNAMENT_SETS_DATA.includes(s);
          const href = isOrnament
            ? `#/ornaments/${slugify(s)}`
            : `#/relics/${slugify(s)}`;
          return `
                    <span class="set-name-link">
                        <a href="${href}">
                            <img src="images/relic/${slugify(s)}.webp" alt="" class="item-icon inline-icon" loading="lazy">
                            <span class="set-name-text">${s}</span>
                        </a>
                    </span>`;
        })
        .join("");
    };

    const relicRecommendations = [
      character.relic1,
      character.relic2,
      character.relic3,
      character.relic4,
      character.relic5,
    ].filter((r) => r && r.length > 0);

    const ornamentRecommendations = [
      character.planetary1,
      character.planetary2,
      character.planetary3,
      character.planetary4,
      character.planetary5,
    ].filter((p) => p && p.length > 0);

    appContent.innerHTML = `
            <div class="page-container">
                <div class="page-header">
                    <div class="page-title-with-icon">
                        <img src="images/character-sticker/${slugify(character.name)}.webp" alt="" class="page-main-icon" loading="lazy">
                        <h2>${character.name} Recommended Builds</h2>
                    </div>
                </div>

                <div class="build-section">
                    <h3>Cavern Relics</h3>
                    <div class="build-grid build-relics">
                        ${
                          relicRecommendations.length > 0
                            ? relicRecommendations
                                .map((relicSetOption, index) => {
                                  const isTwoPlusTwo =
                                    relicSetOption.length > 1 &&
                                    relicSetOption.every((setName) =>
                                      RELIC_SETS_DATA.includes(setName),
                                    );
                                  const optionTitle = `Option ${index + 1}${isTwoPlusTwo && relicSetOption.length === 2 ? " (2 pcs + 2 pcs)" : ""}`;
                                  return `
                            <div class="stat-group">
                                <h4>${optionTitle}</h4>
                                <p class="relic-option-list">${formatSetList(relicSetOption)}</p>
                            </div>
                        `;
                                })
                                .join("")
                            : "<p>No specific relic set recommendations found.</p>"
                        }
                    </div>
                </div>
                
                <div class="build-section">
                    <h3>Planar Ornaments</h3>
                     <div class="build-grid build-planer-ornaments">
                        ${
                          ornamentRecommendations.length > 0
                            ? ornamentRecommendations
                                .map(
                                  (ornamentSet, index) => `
                            <div class="stat-group">
                                <h4>Option ${index + 1}</h4>
                                <p class="relic-option-list">${formatSetList(ornamentSet)}</p>
                            </div>
                        `,
                                )
                                .join("")
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
            </div>
        `;
  }

  function renderRelicSetPage(setSlug, isOrnamentContext) {
    const setName = findOriginalSetName(setSlug);
    document.title = `${setName} - ${siteTitle}`;

    const isActualOrnament = ORNAMENT_SETS_DATA.includes(setName);
    const isActualRelic = RELIC_SETS_DATA.includes(setName);

    if (!isActualOrnament && !isActualRelic) {
      appContent.innerHTML = `<div class="page-container"><p>Relic set not found: ${setName}</p><p><a href="#">Go Home</a></p></div>`;
      return;
    }

    let setInfoHtml = "";
    const setData = relicSetDetailsData.find((s) => s.Name === setName);

    if (setData) {
      setInfoHtml += `<div class="relic-set-bonuses">`;
      if (setData["2-Piece Bonus"]) {
        setInfoHtml += `<h4>2-Piece Bonus</h4><p>${setData["2-Piece Bonus"]}</p>`;
      }
      if (
        setData["4-Piece Bonus"] &&
        setData["4-Piece Bonus"].trim() !== "" &&
        isActualRelic
      ) {
        setInfoHtml += `<h4>4-Piece Bonus</h4><p>${setData["4-Piece Bonus"]}</p>`;
      }
      setInfoHtml += `</div>`;
    }

    const pieceOrder = isActualOrnament ? ["SPHERE", "ROPE"] : ["BODY", "FEET"];
    let mainStatHtml =
      '<table class="analysis-table"><thead><tr><th>Main Stat</th><th>Used By</th></tr></thead><tbody>';

    for (const piece of pieceOrder) {
      const possibleMainStats = MAIN_STATS_SCHEMA[piece];
      let pieceStatsHtml = "";

      for (const stat of possibleMainStats) {
        let users = characterBuilds.filter((char) => { // characterBuilds is already Release/ID-sorted
          let usesThisSet = false;
          if (isActualOrnament) {
            usesThisSet = char.planetarySetConcat.includes(setName);
          } else {
            usesThisSet = char.relicSetConcat.includes(setName);
          }
          if (!usesThisSet) return false;

          let charPieceStats = [];
          if (piece === "BODY") charPieceStats = char.body;
          else if (piece === "FEET") charPieceStats = char.feet;
          else if (piece === "SPHERE") charPieceStats = char.planarSphere;
          else if (piece === "ROPE") charPieceStats = char.linkRope;

          return charPieceStats.includes(stat);
        });

        // MODIFIED for Req 1: Sort users by ID (descending)
        // Though characterBuilds is pre-sorted, explicit sort here is safer after filtering.
        users.sort((a, b) => {
          if (b.Release !== a.Release) {
            return (b.Release || 0) - (a.Release || 0);
          }
          return (a.ID || 0) - (b.ID || 0);
        });

        const userCount = users.length;
        const statClass = userCount > 0 ? "stat-used" : "stat-unused";
        const charListId = `mainstat-chars-${slugify(piece)}-${slugify(stat)}`;
        const toggleText =
          userCount > 0
            ? `${userCount} character${userCount !== 1 ? "s" : ""}`
            : `0 characters`;
        const toggleClass = userCount > 0 ? "" : "no-users";

        pieceStatsHtml += `<tr><td><span class="stat-value ${statClass}">${stat}</span></td><td>`;

        if (userCount > 0) {
          pieceStatsHtml += `<span class="char-count-toggle ${toggleClass}" data-target-id="${charListId}">${toggleText}</span>`;
          pieceStatsHtml += `<div id="${charListId}" class="character-list-tooltip" style="display:none;">
                                        ${users
                                          .map(
                                            (u) => `
                                            <a href="#/characters/${slugify(u.name)}" class="char-tooltip-link">
                                                <img src="images/character/${slugify(u.name)}.webp" alt="" class="item-icon tooltip-icon" loading="lazy">
                                                ${u.name}
                                            </a>`,
                                          )
                                          .join("")}
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
    characterBuilds.forEach((char) => {
      let usesThisSet = false;
      if (isActualOrnament) {
        usesThisSet = char.planetarySetConcat.includes(setName);
      } else {
        usesThisSet = char.relicSetConcat.includes(setName);
      }

      if (usesThisSet) {
        char.substatsClean.forEach((sub) => {
          if (!relevantSubstatsMap.has(sub)) {
            relevantSubstatsMap.set(sub, new Set());
          }
          relevantSubstatsMap.get(sub).add(char.name);
        });
      }
    });

    let substatSectionHtml =
      "<p>This shows which substats are generally prioritized by characters who equip this set.</p>";
    substatSectionHtml +=
      '<table class="analysis-table"><thead><tr><th>Substat</th><th>Prioritized By</th></tr></thead><tbody>';
    const sortedCanonicals = [...SUBSTATS_CANONICAL];

    for (const stat of sortedCanonicals) {
      const usersSet = relevantSubstatsMap.get(stat) || new Set();
      const userCount = usersSet.size;
      const statClass = userCount > 0 ? "stat-used" : "stat-unused";
      
      // MODIFIED for Req 1: Sort users by ID (descending)
      let usersArrayWithDetails = Array.from(usersSet).map(name =>
          characterBuilds.find(char => char.name === name)
      ).filter(Boolean); // Filter out if any char not found (should be rare)

      usersArrayWithDetails.sort((a, b) => {
        if (b.Release !== a.Release) {
          return (b.Release || 0) - (a.Release || 0);
        }
        return (a.ID || 0) - (b.ID || 0);
      });
      const usersNameArraySorted = usersArrayWithDetails.map(char => char.name);

      const charListId = `substat-chars-${slugify(stat)}`;
      const toggleText =
        userCount > 0
          ? `${userCount} character${userCount !== 1 ? "s" : ""}`
          : `0 characters`;
      const toggleClass = userCount > 0 ? "" : "no-users";

      substatSectionHtml += `<tr>
                                    <td><span class="stat-value ${statClass}">${stat}</span></td>
                                    <td>`;
      if (userCount > 0) {
        substatSectionHtml += `<span class="char-count-toggle ${toggleClass}" data-target-id="${charListId}">${toggleText}</span>
                                        <div id="${charListId}" class="character-list-tooltip" style="display:none;">
                                            ${usersNameArraySorted // Use ID-sorted names
                                              .map(
                                                (u_name) => `
                                                <a href="#/characters/${slugify(u_name)}" class="char-tooltip-link">
                                                    <img src="images/character/${slugify(u_name)}.webp" alt="" class="item-icon tooltip-icon" loading="lazy">
                                                    ${u_name}
                                                </a>`,
                                              )
                                              .join("")}
                                        </div>`;
      } else {
        substatSectionHtml += `<span class="char-count-toggle ${toggleClass}">${toggleText}</span>`;
      }
      substatSectionHtml += `</td>
                                   </tr>`;
    }
    substatSectionHtml += "</tbody></table>";

    appContent.innerHTML = `
            <div class="page-container">
                <div class="page-header">
                     <div class="page-title-with-icon">
                        <img src="images/relic/${slugify(setName)}.webp" alt="" class="page-main-icon" loading="lazy">
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
            </div>
        `;
  }

  // --- Search Popup Logic ---
  function openSearchPopup() {
    searchPopup.style.display = "flex";
    universalSearchInput.value = lastUniversalSearchQueryValue; // MODIFIED for Req 2
    universalSearchInput.focus();
    document.body.style.overflow = "hidden";
    handleUniversalSearch(); // MODIFIED for Req 2 (to populate based on restored query)
    currentSearchFocusIndex = -1;
    removeSearchItemFocus();
  }

  function closeSearchPopup() {
    searchPopup.style.display = "none";
    // universalSearchInput.value = ""; // Do not clear, let it persist for next open within session
    universalSearchResults.innerHTML =
      '<p class="search-prompt">Type to start searching.</p>';
    document.body.style.overflow = "";
    currentSearchFocusIndex = -1;
    searchableListItems = [];
    // lastUniversalSearchQueryValue is NOT cleared here.
  }

  function removeSearchItemFocus() {
    searchableListItems.forEach((item) =>
      item.classList.remove("focused-search-item"),
    );
    universalSearchInput.classList.remove("focused-search-item");
  }

  function focusSearchInput() {
    removeSearchItemFocus();
    universalSearchInput.focus();
    currentSearchFocusIndex = -1;
  }

  function addSearchItemFocus(index) {
    removeSearchItemFocus();
    if (searchableListItems[index]) {
      searchableListItems[index].classList.add("focused-search-item");
      searchableListItems[index].scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
      currentSearchFocusIndex = index;
    }
  }

  function handleUniversalSearch() {
    const currentInputValue = universalSearchInput.value;
    lastUniversalSearchQueryValue = currentInputValue; // MODIFIED for Req 2: Remember current input
    const query = currentInputValue.trim().toLowerCase(); // For search logic

    currentSearchFocusIndex = -1;
    removeSearchItemFocus();

    if (!query) {
      universalSearchResults.innerHTML =
        '<p class="search-prompt">Type to start searching.</p>';
      universalSearchClearBtn.innerHTML = "×";
      searchableListItems = [];
      return;
    }
    universalSearchClearBtn.innerHTML = "×";

    let html = "";

    // MODIFIED for Req 1: Search results are alphabetically sorted
    const matchingRelics = RELIC_SETS_DATA
      .filter((name) => name.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b)); // Alphabetical sort
    if (matchingRelics.length > 0) {
      html += '<h3>Cavern Relics</h3><ul class="search-results-list">';
      matchingRelics.forEach((name) => {
        const slug = slugify(name);
        html += `<li><a href="#/relics/${slug}" tabindex="-1"><img src="images/relic/${slug}.webp" alt="" class="item-icon search-result-icon" loading="lazy">${name}</a></li>`; // MODIFIED: Added loading="lazy" for Req 3
      });
      html += "</ul>";
    }

    const matchingOrnaments = ORNAMENT_SETS_DATA
      .filter((name) => name.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b)); // Alphabetical sort
    if (matchingOrnaments.length > 0) {
      html += '<h3>Planar Ornaments</h3><ul class="search-results-list">';
      matchingOrnaments.forEach((name) => {
        const slug = slugify(name);
        html += `<li><a href="#/ornaments/${slug}" tabindex="-1"><img src="images/relic/${slug}.webp" alt="" class="item-icon search-result-icon" loading="lazy">${name}</a></li>`; // MODIFIED: Added loading="lazy" for Req 3
      });
      html += "</ul>";
    }

    const matchingCharacters = allCharacters // allCharacters is ID-sorted array of names
      .filter((name) => name.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b)); // Alphabetical sort
    if (matchingCharacters.length > 0) {
      html += '<h3>Characters</h3><ul class="search-results-list">';
      matchingCharacters.forEach((name) => {
        const slug = slugify(name);
        html += `<li><a href="#/characters/${slug}" tabindex="-1"><img src="images/character/${slug}.webp" alt="" class="item-icon search-result-icon" loading="lazy">${name}</a></li>`; // MODIFIED: Added loading="lazy" for Req 3
      });
      html += "</ul>";
    }

    if (!html) {
      universalSearchResults.innerHTML = "<p>No results found.</p>";
      searchableListItems = [];
    } else {
      universalSearchResults.innerHTML = html;
      searchableListItems = Array.from(
        universalSearchResults.querySelectorAll(".search-results-list li"),
      );
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
    if (
      currentHash.startsWith("#/relics") &&
      !currentHash.includes("/", "#/relics".length + 1)
    ) {
      activeLink = mainNav.querySelector('a[data-nav-path="/relics"]');
    } else if (
      currentHash.startsWith("#/ornaments") &&
      !currentHash.includes("/", "#/ornaments".length + 1)
    ) {
      activeLink = mainNav.querySelector('a[data-nav-path="/ornaments"]');
    } else if (
      currentHash.startsWith("#/characters") &&
      !currentHash.includes("/", "#/characters".length + 1)
    ) {
      activeLink = mainNav.querySelector('a[data-nav-path="/characters"]');
    } else if (currentHash === "#/" || currentHash === "") {
      activeLink = mainNav.querySelector('a[data-nav-path="/"]');
    }

    if (activeLink) {
      activeLink.classList.add("active");
    }
  }

  // --- Router ---
  function handleRouteChange() {
    const hash = location.hash;
    const loadingContainer = document.querySelector(".loading-container");
    if (loadingContainer && loadingContainer.style.display !== "none") {
      loadingContainer.style.display = "none";
    }

    if (hash === "#/relics") {
      renderCavernRelicsPage();
    } else if (hash === "#/ornaments") {
      renderPlanarOrnamentsPage();
    } else if (hash === "#/characters") {
      renderCharactersListPage();
    } else if (hash.startsWith("#/characters/")) {
      const charSlug = hash.substring("#/characters/".length);
      const charName =
        allCharacters.find((name) => slugify(name) === charSlug) ||
        deslugify(charSlug);
      renderCharacterPage(charName);
    } else if (hash.startsWith("#/ornaments/")) {
      const ornamentSlug = hash.substring("#/ornaments/".length);
      renderRelicSetPage(ornamentSlug, true);
    } else if (hash.startsWith("#/relics/")) {
      const relicSlug = hash.substring("#/relics/".length);
      renderRelicSetPage(relicSlug, false);
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
        fetch(BUILD_DATA_URL),
        fetch(RELIC_INFO_URL),
      ]);

      if (!buildDataResponse.ok)
        throw new Error(
          `HTTP error! status: ${buildDataResponse.status} for BUILD_DATA_URL`,
        );
      if (!relicInfoResponse.ok)
        throw new Error(
          `HTTP error! status: ${relicInfoResponse.status} for RELIC_INFO_URL`,
        );

      const rawBuildData = await buildDataResponse.json();
      const relicInfoJson = await relicInfoResponse.json();

      relicSetDetailsData = relicInfoJson; // Contains Name, ID, Type

      // MODIFIED for Req 1: Sort relic/ornament sets by ID (descending)
      const relicIdLookup = new Map(relicSetDetailsData.map(item => [item.Name, item.ID]));
      const tempRelicSets = new Set();
      const tempOrnamentSets = new Set();

      relicSetDetailsData.forEach((item) => {
        if (item.Name && typeof item.Name === "string") {
          if (item.Type === "Relic Set") {
            tempRelicSets.add(item.Name);
          } else if (item.Type === "Planetary Ornament Set") {
            tempOrnamentSets.add(item.Name);
          }
        }
      });
      RELIC_SETS_DATA = Array.from(tempRelicSets);
      ORNAMENT_SETS_DATA = Array.from(tempOrnamentSets);

      // Sort by ID (descending)
      RELIC_SETS_DATA.sort((a, b) => (relicIdLookup.get(b) || 0) - (relicIdLookup.get(a) || 0));
      ORNAMENT_SETS_DATA.sort((a, b) => (relicIdLookup.get(b) || 0) - (relicIdLookup.get(a) || 0));

      // ALL_KNOWN_SETS_SORTED is used for parsing logic, keep its original length-based sort.
      ALL_KNOWN_SETS_SORTED = [...RELIC_SETS_DATA, ...ORNAMENT_SETS_DATA].sort(
        (a, b) => b.length - a.length,
      );

      processData(rawBuildData); // Populates characterBuilds (now includes ID)

      // MODIFIED for new sorting requirement: Sort by Release (desc), then ID (desc)
      characterBuilds.sort((a, b) => {
        if (b.Release !== a.Release) {
          return (b.Release || 0) - (a.Release || 0); // Sort by Release descending (handle undefined)
        }
        return (a.ID || 0) - (b.ID || 0); // Then by ID descending (handle undefined)
      });
      allCharacters = characterBuilds.map((c) => c.name); // allCharacters names will be in the new sorted order

      appContent.addEventListener("click", function (event) {
        const toggleElement = event.target.closest(".char-count-toggle");
        if (toggleElement && !toggleElement.classList.contains("no-users")) {
          event.preventDefault();
          const targetId = toggleElement.dataset.targetId;
          const targetElement = document.getElementById(targetId);
          if (targetElement) {
            const isHidden =
              targetElement.style.display === "none" ||
              targetElement.style.display === "";
            targetElement.style.display = isHidden ? "block" : "none";
          }
        }
      });

      navSearchButton.addEventListener("click", openSearchPopup);
      searchPopup.addEventListener("click", (event) => {
        if (event.target === searchPopup) closeSearchPopup();
      });
      universalSearchInput.addEventListener("input", handleUniversalSearch);
      universalSearchInput.addEventListener("focus", () => {
        currentSearchFocusIndex = -1;
        removeSearchItemFocus();
      });

      universalSearchClearBtn.addEventListener("click", () => {
        if (universalSearchInput.value) {
          universalSearchInput.value = "";
          lastUniversalSearchQueryValue = ""; // MODIFIED for Req 2: Clear remembered query
          handleUniversalSearch();
          universalSearchInput.focus();
        } else {
          // If input is already empty, clear button acts as close for convenience.
          // lastUniversalSearchQueryValue should already be empty in this case.
          closeSearchPopup();
        }
      });

      document.addEventListener("keydown", (event) => {
        if (searchPopup.style.display === "flex") {
          if (event.key === "Escape") {
            closeSearchPopup();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            if (searchableListItems.length > 0) {
              if (currentSearchFocusIndex < searchableListItems.length - 1) {
                addSearchItemFocus(currentSearchFocusIndex + 1);
              } else {
                addSearchItemFocus(0);
              }
            }
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (searchableListItems.length > 0) {
              if (currentSearchFocusIndex > 0) {
                addSearchItemFocus(currentSearchFocusIndex - 1);
              } else {
                addSearchItemFocus(searchableListItems.length - 1);
              }
            }
          } else if (event.key === "Enter") {
            if (
              currentSearchFocusIndex !== -1 &&
              searchableListItems[currentSearchFocusIndex]
            ) {
              event.preventDefault();
              const linkToClick =
                searchableListItems[currentSearchFocusIndex].querySelector("a");
              if (linkToClick) {
                linkToClick.click();
              }
            }
          }
        } else {
          if (event.key === "/") {
            const activeElement = document.activeElement;
            const isTyping =
              activeElement &&
              (activeElement.tagName === "INPUT" ||
                activeElement.tagName === "TEXTAREA" ||
                activeElement.isContentEditable);
            if (!isTyping) {
              event.preventDefault();
              openSearchPopup();
            }
          }
        }
      });

      handleRouteChange();
    } catch (error) {
      console.error("Failed to load or process data:", error);
      document.title = `Error - ${siteTitle}`;
      appContent.innerHTML = `<div class="page-container"><p>Error loading data. Please try again later. Details: ${error.message}</p></div>`;
    }
  }

  window.addEventListener("hashchange", handleRouteChange);
  initApp();
})();