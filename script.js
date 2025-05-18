(function() {
    'use strict';

    const BUILD_DATA_URL = 'data/builds.json';
    const RELIC_INFO_URL = 'data/relics.json';
    const appContent = document.getElementById('app-content');
    const siteTitle = "Honkai: Star Rail Relic Helper";

    // --- Dynamic Data (will be populated from RELIC_INFO_URL) ---
    let RELIC_SETS_DATA = [];
    let ORNAMENT_SETS_DATA = [];
    let ALL_KNOWN_SETS_SORTED = [];
    let relicSetDetailsData = []; // To store fetched JSON data for relic set bonuses

    // --- Static Schemas & Aliases ---
    const MAIN_STATS_SCHEMA = {
        HEAD: ["HP"],
        HANDS: ["ATK"],
        BODY: ["HP%", "DEF%", "ATK%", "CRIT Rate", "CRIT DMG", "Effect HIT Rate", "Outgoing Healing"],
        FEET: ["HP%", "DEF%", "ATK%", "Speed"],
        SPHERE: ["HP%", "DEF%", "ATK%", "Physical DMG", "Fire DMG", "Ice DMG", "Wind DMG", "Lightning DMG", "Quantum DMG", "Imaginary DMG"],
        ROPE: ["HP%", "DEF%", "ATK%", "Break Effect", "Energy Regen Rate"]
    };

    const SUBSTATS_CANONICAL = [
        "HP", "DEF", "ATK", "HP%", "DEF%", "ATK%", "Speed", "CRIT Rate", "CRIT DMG",
        "Break Effect", "Effect Hit Rate", "Effect RES"
    ];
    const SUBSTAT_ALIASES = {
        "hp": "HP%",
        "def": "DEF%",
        "atk": "ATK%",
        "ehr": "Effect Hit Rate",
        "ehr%": "Effect Hit Rate",
        "eff res": "Effect RES",
        "eff res%": "Effect RES",
        "spd": "Speed",
        "crit rate": "CRIT Rate",
        "crit dmg": "CRIT DMG",
        "break effect%": "Break Effect"
    };

    let characterBuilds = [];
    let allCharacters = [];
    let allRelicSets = [];

    // --- Utility Functions ---
    function slugify(text) {
        if (!text) return '';
        return text.toString().toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]+/g, '')
            .replace(/--+/g, '-');
    }

    function findOriginalSetName(slug) {
        if (!slug) return '';
        const searchName = slug.toLowerCase().replace(/-/g, '');
        // ALL_KNOWN_SETS_SORTED is crucial here
        for (const set of ALL_KNOWN_SETS_SORTED) {
            if (set.toLowerCase().replace(/[^a-z0-9]/g, '') === searchName) {
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
        if (!slug) return '';
        return slug.replace(/-/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    // --- Data Parsing ---
    function parseSetListString(setString) {
        if (!setString || typeof setString !== 'string') return [];
        const foundSets = [];
        let remainingString = setString.trim();

        // ALL_KNOWN_SETS_SORTED is crucial here
        while (remainingString.length > 0) {
            let matched = false;
            for (const setName of ALL_KNOWN_SETS_SORTED) {
                if (remainingString.startsWith(setName)) {
                    foundSets.push(setName);
                    remainingString = remainingString.substring(setName.length).trim();
                    if (remainingString.startsWith(',')) {
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
        if (!substatStr) return {
            clean: [],
            comment: ""
        };
        const originalComment = substatStr;
        let tempStr = substatStr;

        tempStr = tempStr.replace(/\([^)]*\)/g, '');
        tempStr = tempStr.replace(/\[[^\]]*\]/g, '');

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
                const sortedCanonicals = [...SUBSTATS_CANONICAL].sort((a, b) => b.length - a.length);
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
                        if (!aliasFound && SUBSTATS_CANONICAL.map(s => s.toLowerCase()).includes(potentialStat)) {
                            matchedCanonicalStat = SUBSTATS_CANONICAL.find(s => s.toLowerCase() === potentialStat);
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
            comment: originalComment
        };
    }


    function processData(jsonData) {
        characterBuilds = jsonData.map(item => {
            const substatsParsed = parseSubstats(item.Substats);
            return {
                name: item.Name,
                body: item.Body ? item.Body.split(',').map(s => s.trim()) : [],
                feet: item.Feet ? item.Feet.split(',').map(s => s.trim()) : [],
                relicSetConcat: parseSetListString(item['Relic Set Concat']),
                relic1: parseSetListString(item.Relic1),
                relic2: parseSetListString(item.Relic2),
                relic3: parseSetListString(item.Relic3),
                relic4: parseSetListString(item.Relic4),
                relic5: parseSetListString(item.Relic5),
                planarSphere: item['Planar Sphere'] ? item['Planar Sphere'].split(',').map(s => s.trim()) : [],
                linkRope: item['Link Rope'] ? item['Link Rope'].split(',').map(s => s.trim()) : [],
                planetarySetConcat: parseSetListString(item['Planetary Set Concat']),
                planetary1: parseSetListString(item.Planetary1),
                planetary2: parseSetListString(item.Planetary2),
                planetary3: parseSetListString(item.Planetary3),
                planetary4: parseSetListString(item.Planetary4),
                planetary5: parseSetListString(item.Planetary5),
                substatsClean: substatsParsed.clean,
                substatsComment: substatsParsed.comment,
            };
        });

        allCharacters = characterBuilds.map(c => c.name).sort();

        // Populate allRelicSets for homepage display directly from dynamically loaded data
        allRelicSets = [
            ...RELIC_SETS_DATA.map(name => ({
                name,
                type: 'Relic'
            })), // Already sorted during population
            ...ORNAMENT_SETS_DATA.map(name => ({
                name,
                type: 'Ornament'
            })) // Already sorted
        ];
    }

    // --- Rendering Functions ---
    function renderHomePage() {
        document.title = siteTitle;
        appContent.innerHTML = `
            <div class="home-container">
                <div class="home-column">
                    <h2>Relic Sets</h2>
                    <div class="search-container">
                        <input type="text" id="relic-search" class="search-input" placeholder="Search relic sets...">
                        <button class="search-clear-btn" id="clear-relic-search" tabindex="-1">×</button>
                    </div>
                    <div id="relic-list-container" class="item-list-scroll-container">
                        <div class="relic-list-section">
                            <h3>Cavern Relics</h3>
                            <ul id="relic-list-cavern" class="content-list"></ul>
                        </div>
                        <div class="relic-list-section">
                            <h3>Planar Ornaments</h3>
                            <ul id="relic-list-planetary" class="content-list"></ul>
                        </div>
                    </div>
                </div>
                <div class="home-column">
                    <h2>Characters</h2>
                    <div class="search-container">
                        <input type="text" id="char-search" class="search-input" placeholder="Search characters...">
                        <button class="search-clear-btn" id="clear-char-search" tabindex="-1">×</button>
                    </div>
                    <div class="item-list-scroll-container">
                        <ul id="char-list" class="content-list"></ul>
                    </div>
                </div>
            </div>
        `;
        renderCharacterList(allCharacters);
        renderRelicSetList(allRelicSets);

        document.getElementById('char-search').addEventListener('input', e => renderCharacterList(allCharacters, e.target.value));
        document.getElementById('clear-char-search').addEventListener('click', () => {
            document.getElementById('char-search').value = '';
            renderCharacterList(allCharacters);
        });
        document.getElementById('relic-search').addEventListener('input', e => renderRelicSetList(allRelicSets, e.target.value));
        document.getElementById('clear-relic-search').addEventListener('click', () => {
            document.getElementById('relic-search').value = '';
            renderRelicSetList(allRelicSets);
        });
    }

    function renderCharacterList(characters, filter = '') {
        const listElement = document.getElementById('char-list');
        if (!listElement) return;
        const filtered = characters.filter(name => name.toLowerCase().includes(filter.toLowerCase()));
        listElement.innerHTML = filtered.map(name => `
            <li>
                <a href="#/characters/${slugify(name)}">
                    <img src="images/character/${slugify(name)}.webp" alt="" class="item-icon character-list-icon" onerror="this.style.display='none'">
                    ${name}
                </a>
            </li>`).join('');
    }

    function renderRelicSetList(sets, filter = '') {
        const cavernList = document.getElementById('relic-list-cavern');
        const planetaryList = document.getElementById('relic-list-planetary');
        if (!cavernList || !planetaryList) return;

        const filteredSets = sets.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()));

        cavernList.innerHTML = filteredSets
            .filter(s => s.type === 'Relic')
            .map(s => `
                <li>
                    <a href="#/relics/${slugify(s.name)}">
                        <img src="images/relic/${slugify(s.name)}.webp" alt="" class="item-icon relic-list-icon" onerror="this.style.display='none'">
                        ${s.name}
                    </a>
                </li>`).join('');

        planetaryList.innerHTML = filteredSets
            .filter(s => s.type === 'Ornament')
            .map(s => `
                <li>
                    <a href="#/relics/${slugify(s.name)}">
                        <img src="images/relic/${slugify(s.name)}.webp" alt="" class="item-icon relic-list-icon" onerror="this.style.display='none'">
                        ${s.name}
                    </a>
                </li>`).join('');
    }

    function renderCharacterPage(characterName) {
        document.title = `${characterName} - ${siteTitle}`;
        const character = characterBuilds.find(c => c.name === characterName);
        if (!character) {
            appContent.innerHTML = `<p>Character not found: ${characterName}</p><p><a href="#">Go Home</a></p>`;
            return;
        }

        const formatSetList = (sets) => {
            if (!sets || sets.length === 0) return 'N/A';
            return sets.map(s => `
                <span class="set-name-link">
                    <a href="#/relics/${slugify(s)}">
                        <img src="images/relic/${slugify(s)}.webp" alt="" class="item-icon inline-icon" onerror="this.style.display='none'">
                        <span class="set-name-text">${s}</span>
                    </a>
                </span>`).join('');
        };

        const relicRecommendations = [
            character.relic1, character.relic2, character.relic3, character.relic4, character.relic5
        ].filter(r => r && r.length > 0);

        const ornamentRecommendations = [
            character.planetary1, character.planetary2, character.planetary3, character.planetary4, character.planetary5
        ].filter(p => p && p.length > 0);

        appContent.innerHTML = `
            <div class="page-container">
                <div class="page-header">
                    <div class="page-title-with-icon">
                        <img src="images/character-sticker/${slugify(character.name)}.webp" alt="" class="page-main-icon" onerror="this.style.display='none'">
                        <h2>${character.name} Recommended Builds</h2>
                    </div>
                    <a href="#" class="back-button">Back to Lists</a>
                </div>

                <div class="build-section">
                    <h3>Cavern Relics</h3>
                    <div class="build-grid build-relics">
                        ${relicRecommendations.length > 0 ? relicRecommendations.map((relicSetOption, index) => {
                            const isTwoPlusTwo = relicSetOption.length > 1;
                            const optionTitle = `Option ${index + 1}${isTwoPlusTwo ? ' (2 pcs + 2 pcs)' : ''}`;
                            return `
                            <div class="stat-group">
                                <h4>${optionTitle}</h4>
                                <p class="relic-option-list">${formatSetList(relicSetOption)}</p>
                            </div>
                        `;
                        }).join('') : '<p>No specific relic set recommendations found.</p>'}
                    </div>
                </div>
                
                <div class="build-section">
                    <h3>Planar Ornaments</h3>
                     <div class="build-grid build-planer-ornaments">
                        ${ornamentRecommendations.length > 0 ? ornamentRecommendations.map((ornamentSet, index) => `
                            <div class="stat-group">
                                <h4>Option ${index + 1}</h4>
                                <p class="relic-option-list">${formatSetList(ornamentSet)}</p>
                            </div>
                        `).join('') : '<p>No specific ornament set recommendations found.</p>'}
                    </div>
                </div>

                <div class="build-section">
                    <h3>Main Stats Priority</h3>
                    <div class="build-grid build-main-stats">
                        <div class="stat-group"><h4>Body</h4><ul><li>${character.body.join(' / ') || 'N/A'}</li></ul></div>
                        <div class="stat-group"><h4>Feet</h4><ul><li>${character.feet.join(' / ') || 'N/A'}</li></ul></div>
                        <div class="stat-group"><h4>Planar Sphere</h4><ul><li>${character.planarSphere.join(' / ') || 'N/A'}</li></ul></div>
                        <div class="stat-group"><h4>Link Rope</h4><ul><li>${character.linkRope.join(' / ') || 'N/A'}</li></ul></div>
                    </div>
                </div>

                <div class="build-section">
                    <h3>Substats Priority</h3>
                    <div class="stat-group">
                        <ul>
                            ${character.substatsClean.map(s => `<li>${s}</li>`).join('') || '<li>No specific substat priorities listed.</li>'}
                        </ul>
                        ${character.substatsComment ? `<div class="substat-comment"><strong>Note:</strong> ${character.substatsComment}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    function renderRelicSetPage(setSlug) {
        const setName = findOriginalSetName(setSlug);
        document.title = `${setName} - ${siteTitle}`;

        const isOrnament = ORNAMENT_SETS_DATA.includes(setName);
        const isRelic = RELIC_SETS_DATA.includes(setName);

        if (!isOrnament && !isRelic) {
            appContent.innerHTML = `<p>Relic set not found: ${setName}</p><p><a href="#">Go Home</a></p>`;
            return;
        }

        let setInfoHtml = '';
        const setData = relicSetDetailsData.find(s => s.Name === setName);

        if (setData) {
            setInfoHtml += `<div class="relic-set-bonuses">`;
            if (setData["2-Piece Bonus"]) {
                setInfoHtml += `<h4>2-Piece Bonus</h4><p>${setData["2-Piece Bonus"]}</p>`;
            }
            if (setData["4-Piece Bonus"] && setData["4-Piece Bonus"].trim() !== "") {
                setInfoHtml += `<h4>4-Piece Bonus</h4><p>${setData["4-Piece Bonus"]}</p>`;
            }
            setInfoHtml += `</div>`;
        }


        const pieceOrder = isOrnament ? ["SPHERE", "ROPE"] : ["BODY", "FEET"]; // Relics focus on Body/Feet for set page, Head/Hands are fixed.

        let mainStatHtml = '<table class="analysis-table"><thead><tr><th>Main Stat</th><th>Used By</th></tr></thead><tbody>';

        for (const piece of pieceOrder) {
            const possibleMainStats = MAIN_STATS_SCHEMA[piece];
            let pieceStatsHtml = '';

            for (const stat of possibleMainStats) {
                const users = characterBuilds.filter(char => {
                    let usesThisSet = false;
                    if (isOrnament) {
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

                const userCount = users.length;
                const statClass = userCount > 0 ? 'stat-used' : 'stat-unused';
                const charListId = `mainstat-chars-${slugify(piece)}-${slugify(stat)}`;
                const toggleText = userCount > 0 ? `${userCount} character${userCount !== 1 ? 's' : ''}` : `0 characters`;
                const toggleClass = userCount > 0 ? '' : 'no-users';


                pieceStatsHtml += `<tr><td><span class="stat-value ${statClass}">${stat}</span></td><td>`;

                if (userCount > 0) {
                    pieceStatsHtml += `<span class="char-count-toggle ${toggleClass}" data-target-id="${charListId}">${toggleText}</span>`;
                    pieceStatsHtml += `<div id="${charListId}" class="character-list-tooltip" style="display:none;">
                                        ${users.map(u => `
                                            <a href="#/characters/${slugify(u.name)}" class="char-tooltip-link">
                                                <img src="images/character/${slugify(u.name)}.webp" alt="" class="item-icon tooltip-icon" onerror="this.style.display='none'">
                                                ${u.name}
                                            </a>`).join('')}
                                      </div>`;
                } else {
                    pieceStatsHtml += `<span class="char-count-toggle ${toggleClass}">${toggleText}</span>`;
                }
                pieceStatsHtml += '</td></tr>';
            }
            mainStatHtml += `<tr><td class="main-stat-type" colspan="2">${piece.charAt(0) + piece.slice(1).toLowerCase()}</td></tr>${pieceStatsHtml}`;
        }
        mainStatHtml += '</tbody></table>';



        const relevantSubstatsMap = new Map();
        characterBuilds.forEach(char => {
            let usesThisSet = false;
            if (isOrnament) {
                usesThisSet = char.planetarySetConcat.includes(setName);
            } else {
                usesThisSet = char.relicSetConcat.includes(setName);
            }

            if (usesThisSet) {
                char.substatsClean.forEach(sub => {
                    if (!relevantSubstatsMap.has(sub)) {
                        relevantSubstatsMap.set(sub, new Set());
                    }
                    relevantSubstatsMap.get(sub).add(char.name);
                });
            }
        });

        let substatSectionHtml = '<p>This shows which substats are generally prioritized by characters who equip this set.</p>';
        substatSectionHtml += '<table class="analysis-table"><thead><tr><th>Substat</th><th>Prioritized By</th></tr></thead><tbody>';
        // const sortedCanonicals = [...SUBSTATS_CANONICAL].sort();
        const sortedCanonicals = [...SUBSTATS_CANONICAL]

        for (const stat of sortedCanonicals) {
            const usersSet = relevantSubstatsMap.get(stat) || new Set();
            const userCount = usersSet.size;
            const statClass = userCount > 0 ? 'stat-used' : 'stat-unused';
            const usersArray = Array.from(usersSet).sort();
            const charListId = `substat-chars-${slugify(stat)}`;
            const toggleText = userCount > 0 ? `${userCount} character${userCount !== 1 ? 's' : ''}` : `0 characters`;
            const toggleClass = userCount > 0 ? '' : 'no-users';

            substatSectionHtml += `<tr>
                                    <td><span class="stat-value ${statClass}">${stat}</span></td>
                                    <td>`;
            if (userCount > 0) {
                substatSectionHtml += `<span class="char-count-toggle ${toggleClass}" data-target-id="${charListId}">${toggleText}</span>
                                        <div id="${charListId}" class="character-list-tooltip" style="display:none;">
                                            ${usersArray.map(u_name => `
                                                <a href="#/characters/${slugify(u_name)}" class="char-tooltip-link">
                                                    <img src="images/character/${slugify(u_name)}.webp" alt="" class="item-icon tooltip-icon" onerror="this.style.display='none'">
                                                    ${u_name}
                                                </a>`).join('')}
                                        </div>`;
            } else {
                substatSectionHtml += `<span class="char-count-toggle ${toggleClass}">${toggleText}</span>`;
            }
            substatSectionHtml += `</td>
                                   </tr>`;
        }
        substatSectionHtml += '</tbody></table>';


        appContent.innerHTML = `
            <div class="page-container">
                <div class="page-header">
                     <div class="page-title-with-icon">
                        <img src="images/relic/${slugify(setName)}.webp" alt="" class="page-main-icon" onerror="this.style.display='none'">
                        <h2>${setName}</h2>
                    </div>
                    <a href="#" class="back-button">Back to Lists</a>
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


    // --- Router ---
    function handleRouteChange() {
        const hash = location.hash;
        const loadingContainer = document.querySelector('.loading-container');
        if (loadingContainer) loadingContainer.style.display = 'none';


        if (hash.startsWith('#/characters/')) {
            const charSlug = hash.substring('#/characters/'.length);
            const charName = allCharacters.find(name => slugify(name) === charSlug) || deslugify(charSlug); 
            if (charName && allCharacters.includes(charName)) {
                 renderCharacterPage(charName);
            } else {
                 document.title = `${deslugify(charSlug)} - ${siteTitle}`;
                 renderCharacterPage(deslugify(charSlug)); 
            }
        } else if (hash.startsWith('#/relics/')) {
            const relicSlug = hash.substring('#/relics/'.length);
            renderRelicSetPage(relicSlug);
        } else {
            renderHomePage();
        }
        window.scrollTo(0, 0);
    }

    // --- Initialization ---
    async function initApp() {
        try {
            const [buildDataResponse, relicInfoResponse] = await Promise.all([
                fetch(BUILD_DATA_URL),
                fetch(RELIC_INFO_URL)
            ]);

            if (!buildDataResponse.ok) throw new Error(`HTTP error! status: ${buildDataResponse.status} for BUILD_DATA_URL`);
            if (!relicInfoResponse.ok) throw new Error(`HTTP error! status: ${relicInfoResponse.status} for RELIC_INFO_URL`);

            const rawBuildData = await buildDataResponse.json();
            const relicInfoJson = await relicInfoResponse.json();

            relicSetDetailsData = relicInfoJson; 

            const tempRelicSets = new Set();
            const tempOrnamentSets = new Set();

            relicSetDetailsData.forEach(item => {
                if (item.Name && typeof item.Name === 'string') {
                    if (item.Type === "Relic Set") {
                        tempRelicSets.add(item.Name);
                    } else if (item.Type === "Planetary Ornament Set") {
                        tempOrnamentSets.add(item.Name);
                    }
                }
            });
            RELIC_SETS_DATA = Array.from(tempRelicSets).sort();
            ORNAMENT_SETS_DATA = Array.from(tempOrnamentSets).sort();

            ALL_KNOWN_SETS_SORTED = [...RELIC_SETS_DATA, ...ORNAMENT_SETS_DATA].sort((a, b) => b.length - a.length);
            
            processData(rawBuildData);

            appContent.addEventListener('click', function(event) {
                const toggleElement = event.target.closest('.char-count-toggle');
                if (toggleElement && !toggleElement.classList.contains('no-users')) {
                    event.preventDefault();
                    const targetId = toggleElement.dataset.targetId;
                    const targetElement = document.getElementById(targetId);
                    if (targetElement) {
                        const isHidden = targetElement.style.display === 'none' || targetElement.style.display === '';
                        targetElement.style.display = isHidden ? 'block' : 'none';
                    }
                }
            });

            handleRouteChange(); 
        } catch (error) {
            console.error("Failed to load or process data:", error);
            document.title = `Error - ${siteTitle}`;
            appContent.innerHTML = `<p>Error loading data. Please try again later. Details: ${error.message}</p>`;
        }
    }

    window.addEventListener('hashchange', handleRouteChange);
    initApp();

})();
