/**
 * Core logic for Hall of Fame generation
 * Fetches existing hall of fame data, missing contest winners, and assembles complete post
 * Uses fetchWithBackoff from index.js for API throttle compliance
 */

/**
 * Fetch Hall of Fame data from Stack Exchange Q14939
 * Returns existing entries and the highest contest number
 */
async function fetchHallOfFameData() {
    try {
        const hofPostId = 14939;
        const apiUrl = `https://api.stackexchange.com/2.3/questions/${hofPostId}/answers?order=desc&sort=activity&site=gaming.meta.stackexchange.com&filter=withbody`;
        
        const data = await fetchWithBackoff(apiUrl, 'answers');
        
        if (!data.items || data.items.length === 0) {
            throw new Error("No hall of fame answers found");
        }
        
        // Get the latest answer (most recent update)
        const latestAnswer = data.items[0];
        const markdown = latestAnswer.body;
        
        // Parse entries from markdown
        const entries = parseHallOfFameEntries(markdown);
        console.log(`Parsed ${entries.length} existing HOF entries`);
        if (entries.length > 0) {
            console.log(`Entry contest numbers: ${entries.map(e => e.contestNum).join(', ')}`);
        }
        
        // Parse reference links to get screenshot URLs (if any are in markdown format)
        // In HTML format, screenshots are already extracted from img tags
        // populateScreenshotUrls(entries, markdown);
        
        // Find the highest contest number
        let maxContestNum = 0;
        entries.forEach(entry => {
            if (entry.contestNum > maxContestNum) {
                maxContestNum = entry.contestNum;
            }
        });
        
        console.log(`Highest existing contest: #${maxContestNum}`);
        
        // Extract browsing links from the markdown
        const browsingLinks = extractBrowsingLinks(markdown);
        
        return {
            entries: entries,
            lastContestNum: maxContestNum,
            hofAnswerId: latestAnswer.answer_id,
            browsingLinks: browsingLinks
        };
    } catch (error) {
        console.error("Error fetching hall of fame data:", error);
        throw error;
    }
}

/**
 * Populate screenshot URLs from reference links
 */
function populateScreenshotUrls(entries, markdown) {
    // Find image reference links: [123-img]: https://...
    const imageRefMatches = markdown.matchAll(/\[(\d+)-img\]:\s*(\S+)/g);
    const imageRefs = {};
    
    for (const match of imageRefMatches) {
        const contestNum = parseInt(match[1], 10);
        const url = match[2];
        imageRefs[contestNum] = url;
    }
    
    // Populate screenshot URLs in entries
    entries.forEach(entry => {
        if (imageRefs[entry.contestNum]) {
            entry.screenshotUrl = imageRefs[entry.contestNum];
        }
    });
}

/**
 * Extract browsing links from HOF answer
 * Looks for patterns like [1-25]: //meta.arqade.com/a/15414
 * Returns an object mapping range labels to URLs
 */
function extractBrowsingLinks(htmlContent) {
    const browsingLinks = {};
    
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, "text/html");
        
        // Look for the "Jump to:" section with browsing links
        // These are typically in <a> links with href patterns like //meta.arqade.com/a/XXXXX
        const allLinks = doc.querySelectorAll("a");
        
        for (let link of allLinks) {
            const href = link.href || link.getAttribute('href') || '';
            const text = link.textContent.trim();
            
            // Match pattern like "#1 – #25" or "#1–#25"
            const rangeMatch = text.match(/#(\d+)\s*–\s*#(\d+)/);
            
            if (rangeMatch && href.includes('/a/')) {
                const startNum = parseInt(rangeMatch[1], 10);
                const endNum = parseInt(rangeMatch[2], 10);
                const rangeKey = `${startNum}-${endNum}`;
                
                browsingLinks[rangeKey] = {
                    start: startNum,
                    end: endNum,
                    url: href.replace(/^https?:/, ''), // Strip https: for protocol-relative URL
                    label: `#${startNum}–#${endNum}`
                };
                
                console.log(`Extracted browsing link: ${rangeKey} → ${href}`);
            }
        }
    } catch (error) {
        console.warn("Could not extract browsing links:", error);
    }
    
    return browsingLinks;
}

/**
 * Href of a link, without depending on the environment resolving it
 */
function linkHref(link) {
    return link.href || link.getAttribute('href') || '';
}

/**
 * Is this anchor a Stack Exchange game tag link? Markdown "[tag:name]" renders
 * as <a class="post-tag" href="/questions/tagged/name">.
 */
function isGameTagLink(link) {
    const className = link.getAttribute('class') || '';
    return /\bpost-tag\b/.test(className) || /\/questions\/tagged\//.test(linkHref(link));
}

/**
 * Is this anchor just wrapping a screenshot?
 */
function isImageLink(link) {
    return !!link.querySelector("img") || /i\.sstatic\.net|i\.imgur\.com/.test(linkHref(link));
}

/**
 * Text of a node with game tag links restored to "[tag:name]" markdown, so
 * captions keep the tag syntax used throughout the hall of fame.
 */
function markdownTextFrom(node) {
    if (!node) return "";
    const clone = node.cloneNode(true);
    clone.querySelectorAll("a").forEach(link => {
        if (isGameTagLink(link)) {
            link.replaceWith(`[tag:${link.textContent.trim()}]`);
        }
    });
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

/**
 * Reference-link handle for a winner: "Tobias F." -> "tobias-f"
 */
function winnerHandleOf(winner) {
    if (!winner) return "unknown";
    const name = winner.name || winner.winner || "";
    if (winner.handle) return winner.handle;
    if (winner.winnerHandle) return winner.winnerHandle;
    return name.toLowerCase().replace(/\s+/g, '-') || "unknown";
}

/**
 * Every winner of an entry. Entries parsed from older single-winner markup only
 * carry the flat fields, so wrap those in a one-item list.
 */
function entryWinners(entry) {
    if (entry && Array.isArray(entry.winners) && entry.winners.length > 0) {
        return entry.winners;
    }
    return [{
        name: (entry && entry.winner) || "Unknown",
        handle: (entry && entry.winnerHandle) || "",
        userId: (entry && entry.winnerId) || 0,
        userLink: (entry && entry.userLink) || "",
        gameTags: (entry && entry.gameTags) || [],
        screenshotUrl: (entry && entry.screenshotUrl) || "N/A",
        screenshotAlt: (entry && entry.screenshotAlt) || "",
        caption: (entry && entry.caption) || ""
    }];
}

/**
 * Image reference name for a winner's screenshot. Single winners keep the
 * historical "[123-img]" name; ties add a per-winner index.
 */
function imageRefFor(contestNum, index, winnerCount) {
    return winnerCount > 1 ? `${contestNum}-img-${index + 1}` : `${contestNum}-img`;
}

/**
 * Caption for a screenshot: the <em>/<i> following the image, else the
 * neighbouring paragraph (captions are commonly written just above it).
 */
function captionAroundImage(img) {
    if (!img) return "";
    const reference = img.closest("a") || img;
    const paragraph = img.closest("p");

    if (paragraph) {
        for (const emphasis of paragraph.querySelectorAll("em, i")) {
            if (reference.compareDocumentPosition(emphasis) & Node.DOCUMENT_POSITION_FOLLOWING) {
                const caption = markdownTextFrom(emphasis);
                if (caption) return caption;
            }
        }
    }

    // Next paragraph, unless another screenshot or a winner/upvote line follows
    let node = paragraph;
    while (node && node.nextElementSibling) {
        node = node.nextElementSibling;
        const text = markdownTextFrom(node);
        if (!text || text === "---") continue;
        if (node.querySelector && node.querySelector("img")) return "";
        if (/Winners?:|Upvotes:/.test(text)) return "";
        return text.length < 500 ? text : "";
    }

    return "";
}

/**
 * Parse Hall of Fame entries from HTML
 * Stack Exchange API returns HTML, not markdown
 * Looks for patterns like <h3><a href="...">Contest #126</a></h3>
 */
function parseHallOfFameEntries(htmlContent) {
    const entries = [];
    
    if (!htmlContent || htmlContent.trim().length === 0) {
        console.warn("Empty HTML provided to parseHallOfFameEntries");
        return entries;
    }
    
    try {
        // Parse HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, "text/html");
        
        // Find all h3 elements that contain contest headers
        const h3Elements = doc.querySelectorAll("h3");
        console.log(`Found ${h3Elements.length} h3 elements`);
        
        let matchCount = 0;
        h3Elements.forEach((h3, index) => {
            const text = h3.textContent;
            const contestMatch = text.match(/Contest #(\d+)/);
            
            if (contestMatch) {
                matchCount++;
                const contestNum = parseInt(contestMatch[1], 10);
                
                // Skip template entries (have ": …" as the final suffix with no additional text)
                const link = h3.querySelector("a");
                const linkText = link ? link.textContent : h3.textContent;
                if (linkText.trim().match(/: \u2026$/) || linkText.trim().match(/#\d+: \u2026$/)) {
                    console.log(`Skipping template entry #${contestNum}`);
                    return;
                }
                
                console.log(`Match #${matchCount}: Found Contest #${contestNum} in h3 #${index}`);
                
                // Extract post ID and full contest link from the <a> href
                let postId = 0;
                let contestLink = "";
                if (link && link.href) {
                    const postIdMatch = link.href.match(/\/q\/(\d+)/);
                    if (postIdMatch) {
                        postId = parseInt(postIdMatch[1], 10);
                        console.log(`  Post ID: ${postId}`);
                    }
                    // Store the full link from the API response, strip protocol for protocol-relative URLs
                    contestLink = link.href.replace(/^https?:/, '');
                }
                
                // Get all content after this h3 until the next h3
                let currentNode = h3.nextElementSibling;
                let contentHtml = "";
                
                while (currentNode && currentNode.tagName !== "H3") {
                    contentHtml += currentNode.outerHTML;
                    currentNode = currentNode.nextElementSibling;
                }
                
                const entry = parseHallOfFameEntry(contestNum, contentHtml);
                if (entry) {
                    entry.postId = postId;
                    entry.contestLink = contestLink;
                    entries.push(entry);
                }
            }
        });
        
        if (matchCount === 0) {
            console.warn("No contest patterns found. Sample h3 contents:", 
                h3Elements.length > 0 ? h3Elements[0].textContent : "No h3 elements");
        }
        
    } catch (error) {
        console.error("Error parsing HOF entries from HTML:", error);
    }
    
    return entries;
}

/**
 * Parse a single Hall of Fame entry from HTML
 * Extracts: winner, game tag, upvotes, screenshot URL, caption
 */
/**
 * Parse a single Hall of Fame entry from HTML
 *
 * Handles both the single-winner shape and the tie shape:
 *   **Winner:** [A][a] | **Game:** [tag:x] | **Upvotes:** *9*
 *   **Winners:** Tie: [A][a], [B][b] | **Games:** [tag:x], [tag:y] | **Upvotes:** *9*
 *
 * Winners live in entry.winners; the flat fields mirror the first winner so
 * existing callers keep working.
 */
function parseHallOfFameEntry(contestNum, htmlContent) {
    const entry = {
        contestNum: contestNum,
        winner: "Unknown",
        winnerHandle: "",
        winnerId: 0,
        userLink: "",
        gameTags: [],
        upvotes: 0,
        screenshotUrl: "N/A",
        screenshotAlt: "",
        caption: "",
        dateRange: "",
        postId: 0,
        winners: []
    };

    try {
        const doc = new DOMParser().parseFromString(htmlContent, "text/html");
        const paragraphs = Array.from(doc.querySelectorAll("p"));

        // ---- Date range
        const dateParagraph = paragraphs.find(p => (p.textContent || "").includes("Date:"));
        if (dateParagraph) {
            // Rendered "Date:" runs straight into the next label, so stop at the
            // winner/games/upvotes label instead of relying on a line break
            const dateMatch = dateParagraph.textContent.match(/Date:\s*([^|\n]+?)(?=\s*(?:Winners?:|Games?:|Upvotes:|$))/);
            if (dateMatch) {
                entry.dateRange = dateMatch[1].trim();
                console.log(`  #${contestNum} - Date: ${entry.dateRange}`);
            }
        }

        // ---- Winners, games and upvotes share one paragraph
        const winnersParagraph = paragraphs.find(p => /Winners?:/.test(p.textContent || ""));
        let winnerSpecs = [];
        let winnerTags = [];

        if (winnersParagraph) {
            // Captions can share the paragraph and carry tags of their own, so
            // bound each part of the line by its label:
            //   **Winner(s):** <links> | **Game(s):** <tags> | **Upvotes:** <n>
            const labels = Array.from(winnersParagraph.querySelectorAll("strong"));
            const labelOf = pattern => labels.find(label => pattern.test(label.textContent.trim()));
            const winnerLabel = labelOf(/^Winners?:$/);
            const gameLabel = labelOf(/^Games?:$/);
            const upvotesLabel = labelOf(/^Upvotes?:$/);
            const after = (node, anchor) => !anchor || (anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
            const before = (node, anchor) => !anchor || (node.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

            const links = Array.from(winnersParagraph.querySelectorAll("a"));
            winnerTags = links
                .filter(link => isGameTagLink(link) && after(link, gameLabel) && before(link, upvotesLabel))
                .map(link => link.textContent.trim())
                .filter((tag, index, all) => tag && all.indexOf(tag) === index);

            winnerSpecs = links
                .filter(link => !isGameTagLink(link) && !isImageLink(link)
                    && after(link, winnerLabel) && before(link, gameLabel))
                .map(link => {
                    const href = linkHref(link);
                    const userIdMatch = href.match(/\/users\/(\d+)/);
                    return {
                        name: link.textContent.trim(),
                        handle: link.textContent.trim().toLowerCase().replace(/\s+/g, '-'),
                        userId: userIdMatch ? parseInt(userIdMatch[1], 10) : 0,
                        userLink: href.replace(/^https?:/, '')
                    };
                })
                .filter(spec => spec.name);

            const upvotesMatch = winnersParagraph.textContent.match(/(?:Upvotes:|won with)\s*\*?(\d+)/);
            if (upvotesMatch) {
                entry.upvotes = parseInt(upvotesMatch[1], 10);
            }
        }

        // Very old entries name the winner without linking them
        if (winnerSpecs.length === 0) {
            const bodyText = (doc.body ? doc.body.textContent : "") || "";
            const nameMatch = bodyText.match(/Winners?:\s*(?:Tie:\s*)?([^|\n]+?)\s*(?=\||Game)/i);
            if (nameMatch) {
                winnerSpecs = nameMatch[1].split(",").map(name => name.trim()).filter(Boolean).map(name => ({
                    name: name,
                    handle: name.toLowerCase().replace(/\s+/g, '-'),
                    userId: 0,
                    userLink: ""
                }));
            }
        }

        // ---- Screenshots, one per winner, each with its caption
        const images = Array.from(doc.querySelectorAll("img")).map(img => ({
            url: img.src,
            alt: img.alt || "",
            caption: captionAroundImage(img)
        }));

        const canMapTags = winnerTags.length === winnerSpecs.length;
        entry.winners = winnerSpecs.map((spec, index) => {
            const image = images[index];
            return {
                name: spec.name,
                handle: spec.handle,
                userId: spec.userId,
                userLink: spec.userLink,
                gameTags: canMapTags && winnerTags[index] ? [winnerTags[index]] : [],
                screenshotUrl: image ? image.url : "N/A",
                screenshotAlt: image ? image.alt : "",
                caption: image ? image.caption : ""
            };
        });

        // Combined tag list for display when per-winner tags are unavailable
        const allTags = Array.from(doc.querySelectorAll("a")).filter(isGameTagLink)
            .map(link => link.textContent.trim())
            .filter((tag, index, all) => tag && all.indexOf(tag) === index);
        entry.gameTags = winnerTags.length > 0 ? winnerTags : allTags;

        if (entry.winners.length > 1) {
            console.log(`  #${contestNum} - ${entry.winners.length}-way tie: ${entry.winners.map(w => w.name).join(', ')}`);
        }

        // ---- Flat fields mirror the first winner
        const first = entry.winners[0];
        if (first) {
            entry.winner = first.name || "Unknown";
            entry.winnerHandle = first.handle || "";
            entry.winnerId = first.userId || 0;
            entry.userLink = first.userLink || "";
            entry.screenshotUrl = first.screenshotUrl || "N/A";
            entry.screenshotAlt = first.screenshotAlt || "";
            entry.caption = first.caption || "";
            console.log(`  #${contestNum} - Winner: ${entry.winner}${entry.winnerId ? ` (ID: ${entry.winnerId})` : ''}`);
        }

        if (entry.caption) {
            console.log(`  #${contestNum} - Caption: ${entry.caption.substring(0, 50)}...`);
        }

        return entry;
    } catch (error) {
        console.error(`Error parsing entry for contest #${contestNum}:`, error);
        return null;
    }
}

/**
 * Fetch missing contests between lastContestNum+1 and announcedContestNum-1
 * Parse each SOTW post to extract the winner announcement
 * Uses pagination to handle cases where older posts lose the "featured" tag
 */
async function fetchMissingContests(lastContestNum, announcedContestNum) {
    const missingContests = [];
    
    // We need to fill in contests from (lastContestNum + 1) to (announcedContestNum - 1)
    // When the range is empty (consecutive entries, firstMissing > lastMissing),
    // there's nothing to extract — the contest is already in the HOF.
    const firstMissing = lastContestNum + 1;
    const lastMissing = announcedContestNum - 1;
    
    if (firstMissing > lastMissing) {
        // No contests to fetch — the HOF is already up to date through announcedContestNum - 1
        return missingContests;
    }
    
    // Track which contest posts we've successfully found
    const foundContests = new Set();
    const allPostsTitles = [];
    
    // Fetch SOTW posts with pagination
    try {
        let page = 1;
        let hasMore = true;
        
        while (hasMore && foundContests.size < (lastMissing - firstMissing + 1)) {
            // Removed "featured" tag to include older posts that lost their featured badge
            const apiUrl = `https://api.stackexchange.com/2.3/questions?order=desc&sort=creation&tagged=screenshot-of-the-week&site=gaming.meta.stackexchange.com&pagesize=100&page=${page}&filter=withbody`;
            const data = await fetchWithBackoff(apiUrl, 'questions');
            
            if (!data.items || data.items.length === 0) {
                console.warn(`No items found on page ${page}`);
                hasMore = false;
                break;
            }
            
            console.log(`Fetched page ${page}: ${data.items.length} posts`);
            
            // Collect all post titles for logging (helpful for debugging)
            data.items.forEach(post => {
                const titleMatch = post.title.match(/#(\d+)/);
                if (titleMatch) {
                    allPostsTitles.push(`#${titleMatch[1]}`);
                }
            });
            
            // For each contest number we need, find the corresponding post
            for (let contestNum = firstMissing; contestNum <= lastMissing; contestNum++) {
                if (foundContests.has(contestNum)) {
                    continue; // Already found this contest
                }
                
                // Find the post for this contest (the next one after this contest)
                // Because contest #144 is announced in post #145
                const postContestNum = contestNum + 1;
                const post = data.items.find(p => {
                    const titleMatch = p.title.match(/#(\d+)/);
                    return titleMatch && parseInt(titleMatch[1], 10) === postContestNum;
                });
                
                if (post) {
                    // Fetch the full post body using answers endpoint which has better body support
                    const postApiUrl = `https://api.stackexchange.com/2.3/questions/${post.question_id}?order=desc&sort=activity&site=gaming.meta.stackexchange.com&filter=withbody`;
                    const postData = await fetchWithBackoff(postApiUrl, 'questions');
                    
                    if (postData.items && postData.items.length > 0) {
                        const fullPost = postData.items[0];
                        
                        // Check if body is in the response; if not, try fetching via different endpoint
                        let postBody = fullPost.body;
                        
                        if (!postBody) {
                            // Try fetching with explicit filter parameter
                            const altUrl = `https://api.stackexchange.com/2.3/questions/${post.question_id}?site=gaming.meta.stackexchange.com&filter=withbody`;
                            const altData = await fetchWithBackoff(altUrl, 'questions');
                            if (altData.items && altData.items[0] && altData.items[0].body) {
                                postBody = altData.items[0].body;
                            }
                        }
                        
                        const winnerData = await extractWinnerFromPost({...fullPost, body: postBody}, contestNum);
                        if (winnerData) {
                            missingContests.push(winnerData);
                            foundContests.add(contestNum);
                            console.log(`Successfully fetched contest #${contestNum}`);
                        } else {
                            console.warn(`Failed to extract winner for contest #${contestNum} from post #${postContestNum}`);
                        }
                    } else {
                        console.warn(`Could not fetch full body for post #${postContestNum} (contest #${contestNum})`);
                    }
                } else {
                    console.warn(`Post for contest #${contestNum} (looking for #${postContestNum}) not found on page ${page}`);
                }
            }
            
            // Check if we should continue pagination
            if (data.has_more) {
                page++;
            } else {
                hasMore = false;
            }
        }
        
        // Log summary of what we found vs what we looked for
        console.log(`Posts found in pagination: ${allPostsTitles.join(', ')}`);
        const notFound = [];
        for (let i = firstMissing; i <= lastMissing; i++) {
            if (!foundContests.has(i)) {
                notFound.push(i);
            }
        }
        if (notFound.length > 0) {
            console.warn(`Failed to fetch contests: #${notFound.join(', #')}`);
        } else {
            console.log(`Successfully fetched all missing contests`);
        }
        
    } catch (error) {
        console.error("Error fetching missing contests:", error);
        throw error;
    }
    
    return missingContests;
}

/**
 * Parse the winner announcement at the top of a SOTW post.
 *
 * A single winner is announced in one paragraph; a tie is announced as a list
 * with one <li> per winner, each carrying that winner's own screenshot, game
 * tag and upvotes. Returns every winner so ties reach the hall of fame intact.
 *
 * @returns {{dateRange: string, upvotes: number, winners: Array}}
 */
function parseWinnerAnnouncement(postBody) {
    const result = { dateRange: "", upvotes: 0, winners: [] };
    if (!postBody) {
        return result;
    }

    const doc = new DOMParser().parseFromString(postBody, "text/html");
    const fullText = (doc.body ? doc.body.textContent : "") || "";

    const dateMatch = fullText.match(/Date:\s*([^\n]+?)(?:\n|$)/);
    if (dateMatch) {
        result.dateRange = dateMatch[1].trim();
    }

    const upvotesMatch = fullText.match(/won with\s+(\d+)\s+upvotes?/i);
    if (upvotesMatch) {
        result.upvotes = parseInt(upvotesMatch[1], 10);
    }

    // Ties list the winners as <li> entries that link to each winning answer
    let blocks = Array.from(doc.querySelectorAll("li")).filter(li => {
        const text = li.textContent || "";
        if (!/'s screenshot/i.test(text)) return false;
        return Array.from(li.querySelectorAll("a")).some(link => /\/a\/\d+/.test(linkHref(link)));
    });

    // A single winner is announced in one paragraph
    if (blocks.length === 0) {
        const paragraph = Array.from(doc.querySelectorAll("p")).find(p => {
            const text = p.textContent || "";
            return /'s screenshot/i.test(text) && /upvotes?/i.test(text);
        });
        if (paragraph) {
            blocks = [paragraph];
        }
    }

    const documentImage = doc.querySelector("img");

    result.winners = blocks.map(block => {
        const blockText = (block.textContent || "").replace(/\s+/g, " ");
        const links = Array.from(block.querySelectorAll("a"));
        const answerLink = links.find(link => /\/a\/\d+/.test(linkHref(link)));
        const userLink = links.find(link => /\/users\/\d+/.test(linkHref(link)));

        let name = "";
        if (answerLink) {
            name = answerLink.textContent.trim();
        } else if (userLink) {
            name = userLink.textContent.trim();
        } else {
            const nameMatch = blockText.match(/([A-Za-z][A-Za-z0-9\s.'-]*?)'s screenshot/i);
            if (nameMatch) {
                name = nameMatch[1].trim();
            }
        }
        if (!name) {
            return null;
        }

        const userIdMatch = userLink ? linkHref(userLink).match(/\/users\/(\d+)/) : null;
        const answerIdMatch = answerLink ? linkHref(answerLink).match(/\/a\/(\d+)/) : null;
        const blockUpvotesMatch = blockText.match(/(\d+)\s+upvotes?/i);
        // Only a lone winner may borrow the post's first screenshot; in a tie
        // each winner's image has to come from their own list item
        const image = block.querySelector("img") || (blocks.length === 1 ? documentImage : null);

        return {
            name: name,
            handle: name.toLowerCase().replace(/\s+/g, '-'),
            userId: userIdMatch ? parseInt(userIdMatch[1], 10) : 0,
            userLink: userLink ? linkHref(userLink).replace(/^https?:/, '') : "",
            answerId: answerIdMatch ? parseInt(answerIdMatch[1], 10) : 0,
            gameTags: links.filter(isGameTagLink).map(link => link.textContent.trim())
                .filter((tag, index, all) => tag && all.indexOf(tag) === index),
            upvotes: blockUpvotesMatch ? parseInt(blockUpvotesMatch[1], 10) : 0,
            screenshotUrl: image ? image.src : "N/A",
            screenshotAlt: image ? (image.alt || "") : "",
            caption: ""
        };
    }).filter(Boolean);

    if (result.winners.length === 0) {
        return result;
    }

    // Fall back to the post-wide numbers when a block does not spell them out
    if (!result.upvotes) {
        result.upvotes = result.winners[0].upvotes || 0;
    }
    result.winners.forEach(winner => {
        if (!winner.upvotes) {
            winner.upvotes = result.upvotes;
        }
    });

    // Tags sometimes sit outside the winner block; use the post's first tag
    // rather than announcing a winner with no game at all
    if (result.winners.length === 1 && result.winners[0].gameTags.length === 0) {
        const firstTag = Array.from(doc.querySelectorAll("a")).find(isGameTagLink);
        if (firstTag) {
            result.winners[0].gameTags = [firstTag.textContent.trim()];
        } else {
            const plainTagMatch = fullText.match(/from\s+([\w\-]+)/i);
            if (plainTagMatch) {
                result.winners[0].gameTags = [plainTagMatch[1]];
            }
        }
    }

    return result;
}

/**
 * Caption written alongside the screenshot in a winning answer body
 */
function captionFromAnswerBody(answerBody) {
    if (!answerBody) return "";

    const doc = new DOMParser().parseFromString(answerBody, "text/html");
    const images = doc.querySelectorAll("img");
    if (images.length === 0) {
        return "";
    }

    const paragraphs = Array.from(doc.querySelectorAll("p"));
    const imageIndex = paragraphs.findIndex(paragraph => paragraph.contains(images[0]));

    // Caption inline in the image paragraph
    if (imageIndex >= 0) {
        const inline = markdownTextFrom(paragraphs[imageIndex].querySelector("em, i, b"));
        if (inline) return inline;
    }

    // Caption commonly sits just above the screenshot, sometimes just below
    if (imageIndex > 0) {
        const previous = markdownTextFrom(paragraphs[imageIndex - 1]);
        if (previous && previous !== "---" && previous.length < 500) {
            return previous;
        }
    }
    if (imageIndex >= 0 && imageIndex < paragraphs.length - 1) {
        const next = markdownTextFrom(paragraphs[imageIndex + 1]);
        if (next && next !== "---" && next.length < 500) {
            return next;
        }
    }

    return "";
}

/**
 * Extract the winner information from a SOTW post body
 * All SOTW posts now use processAnswersCore, so we know the exact format,
 * including the tie format where each winner has their own entry.
 */
async function extractWinnerFromPost(post, contestNum) {
    try {
        const body = post.body;

        if (!body) {
            console.warn(`No body content for post ${post.question_id} (contest #${contestNum})`);
            return null;
        }

        const announcement = parseWinnerAnnouncement(body);

        if (announcement.winners.length === 0) {
            console.warn(`Could not extract winner from contest #${contestNum}. Pattern not found in: ${body.substring(0, 300)}`);
            return null;
        }

        // Each winner's caption and user id live in their own winning answer
        for (const winner of announcement.winners) {
            if (!winner.answerId) {
                continue;
            }
            try {
                const answerUrl = `https://api.stackexchange.com/2.3/answers/${winner.answerId}?site=gaming.meta.stackexchange.com&filter=withbody`;
                const answerData = await fetchWithBackoff(answerUrl, 'answers');
                if (!answerData.items || answerData.items.length === 0) {
                    continue;
                }

                const answerItem = answerData.items[0];

                if (!winner.userId && answerItem.owner && answerItem.owner.user_id) {
                    winner.userId = answerItem.owner.user_id;
                    console.log(`Extracted winner ID from answer author: ${winner.userId}`);
                }
                if (!winner.userLink && winner.userId) {
                    winner.userLink = `//arqade.com/users/${winner.userId}/${winner.handle}?tab=profile`;
                }

                winner.caption = captionFromAnswerBody(answerItem.body);
                console.log(`Contest #${contestNum} - ${winner.name} caption: "${winner.caption}"`);
            } catch (e) {
                console.warn(`Could not fetch winning answer ${winner.answerId} for contest #${contestNum}:`, e);
            }
        }

        // Build the contest link in HOF format: //meta.arqade.com/q/ID/slug
        let contestLink = `//meta.arqade.com/q/${post.question_id}`;
        if (post.link) {
            const slugMatch = post.link.match(/\/questions\/\d+\/(.+)/);
            if (slugMatch) {
                contestLink = `//meta.arqade.com/q/${post.question_id}/${slugMatch[1]}`;
            }
        }

        // Flat fields mirror the first winner for callers of the old shape
        const first = announcement.winners[0];
        const allGameTags = announcement.winners
            .flatMap(winner => winner.gameTags)
            .filter((tag, index, all) => all.indexOf(tag) === index);

        return {
            contestNum: contestNum,
            contestLink: contestLink,
            winner: first.name,
            winnerHandle: first.handle,
            winnerId: first.userId,
            gameTags: allGameTags,
            upvotes: announcement.upvotes,
            screenshotUrl: first.screenshotUrl,
            screenshotAlt: first.screenshotAlt,
            caption: first.caption,
            dateRange: announcement.dateRange,
            postId: post.question_id,
            winners: announcement.winners
        };
    } catch (error) {
        console.error(`Error extracting winner from contest #${contestNum}:`, error);
        return null;
    }
}

/**
 * Markdown for one Hall of Fame entry.
 *
 *   Single winner: **Winner:** [A][a] | **Game:** [tag:x] | **Upvotes:** *9*
 *   Tie:           **Winners:** Tie: [A][a], [B][b] | **Games:** [tag:x], [tag:y] | **Upvotes:** *9*
 *
 * Each winner then gets their own screenshot and caption; a tied entry keeps
 * every screenshot, numbered references ("[178-img-1]", "[178-img-2]").
 */
function generateEntryMarkdown(entry) {
    const winners = entryWinners(entry);
    const isTie = winners.length > 1;
    const tagsOf = winner => (winner.gameTags || []).map(tag => `[tag:${tag}]`).join(' ');
    const combinedTags = () => (entry.gameTags || []).map(tag => `[tag:${tag}]`).join(' ');

    let markdown = `### [Contest #${entry.contestNum}][${entry.contestNum}-contest]\n`;

    if (entry.dateRange) {
        markdown += `**Date:** ${entry.dateRange}  \n`;
    }

    if (isTie) {
        const names = winners.map(winner => `[${winner.name}][${winnerHandleOf(winner)}]`).join(', ');
        const games = winners.map(tagsOf).filter(Boolean).join(', ') || combinedTags();
        markdown += `**Winners:** Tie: ${names} | **Games:** ${games} | **Upvotes:** *${entry.upvotes}*  \n`;
    } else {
        const winner = winners[0];
        const games = tagsOf(winner) || combinedTags();
        markdown += `**Winner:** [${winner.name}][${winnerHandleOf(winner)}] | **Game:** ${games} | **Upvotes:** *${entry.upvotes}*  \n`;
    }

    winners.forEach((winner, index) => {
        if (!winner.screenshotUrl || winner.screenshotUrl === "N/A") {
            return;
        }
        const reference = imageRefFor(entry.contestNum, index, winners.length);
        const defaultAlt = `Contest #${entry.contestNum} winning screenshot${isTie ? ` ${index + 1}` : ''}`;
        // Alt text cannot contain brackets; they would close the image link
        const altText = (winner.screenshotAlt || defaultAlt).replace(/[[\]]/g, '').trim() || defaultAlt;
        // A lone winner keeps the historical soft break (caption flows after the
        // screenshot); tied winners get a line break so their blocks stay apart
        markdown += `[![${altText}][${reference}]][${reference}]${isTie ? '  \n' : '\n'}`;
        if (winner.caption) {
            markdown += `*${winner.caption}*  \n`;
        }
    });

    return markdown;
}

/**
 * Generate a Hall of Fame entry for new winner data
 */
function generateWinnerEntry(winnerData) {
    const entry = {
        contestNum: winnerData.contestNum,
        dateRange: winnerData.dateRange,
        upvotes: winnerData.upvotes,
        gameTags: winnerData.gameTags || [],
        winners: winnerData.winners || []
    };

    const markdown = generateEntryMarkdown(entry);
    const winners = entryWinners(entry);
    const first = winners[0];

    return {
        markdown: markdown,
        referenceLink: `  [${entry.contestNum}-contest]:       //meta.arqade.com/q/${winnerData.postId}`,
        imageReference: first && first.screenshotUrl && first.screenshotUrl !== "N/A" ? `  [${entry.contestNum}-img]:           ${first.screenshotUrl}` : null,
        userReference: `  [${winnerHandleOf(first)}]:       ${first.userId ? `//arqade.com/users/${first.userId}/${winnerHandleOf(first)}` : `//arqade.com/users/0`}`
    };
}

/**
 * Format a number as an ordinal string (1st, 2nd, 3rd, 4th, ...)
 */
function formatOrdinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];

/**
 * Format start/end Dates as a HOF-style date range string
 */
function formatDateRange(startDate, endDate) {
    const startDay = startDate.getDate();
    const startMonth = MONTH_NAMES[startDate.getMonth()];
    const endDay = endDate.getDate();
    const endMonth = MONTH_NAMES[endDate.getMonth()];
    const endYear = endDate.getFullYear();

    if (startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear()) {
        return `${formatOrdinal(startDay)}\u2013${formatOrdinal(endDay)} of ${endMonth}, ${endYear}`;
    } else {
        return `${formatOrdinal(startDay)} of ${startMonth} \u2013 ${formatOrdinal(endDay)} of ${endMonth}, ${endYear}`;
    }
}

/**
 * Parse the start date from a HOF-style date range string
 * Handles both "6th\u201320th of October, 2025" and "22nd of September \u2013 6th of October, 2025"
 */
function parseContestStartDate(dateRange) {
    if (!dateRange) return null;

    // Format 1: cross-month "22nd of September \u2013 6th of October, 2025"
    const crossMonth = dateRange.match(/(\d+)(?:st|nd|rd|th)\s+of\s+(\w+)\s*[\u2013-]/i);
    if (crossMonth) {
        const day = parseInt(crossMonth[1], 10);
        const month = crossMonth[2];
        // Year is at the end of the string
        const yearMatch = dateRange.match(/(\d{4})/);
        const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
        const d = new Date(`${month} ${day}, ${year}`);
        if (!isNaN(d)) return d;
    }

    // Format 2: same-month "6th\u201320th of October, 2025"
    const sameMonth = dateRange.match(/(\d+)(?:st|nd|rd|th)[\u2013-](\d+)(?:st|nd|rd|th)\s+of\s+(\w+),?\s*(\d{4})/i);
    if (sameMonth) {
        const day = parseInt(sameMonth[1], 10);
        const month = sameMonth[3];
        const year = parseInt(sameMonth[4], 10);
        const d = new Date(`${month} ${day}, ${year}`);
        if (!isNaN(d)) return d;
    }

    return null;
}

/**
 * Assemble complete Hall of Fame post
 * Combines existing entries with new entries, adds template section, and generates all references
 * 
 * @param {Array} existingEntries - Parsed entries from existing HOF answer
 * @param {Array} newWinnerDataList - New winner data from fetchMissingContests
 * @param {Object} browsingLinks - Existing browsing links from HOF answer
 * @param {number} announcedContestNum - Contest number of the just-announced post
 * @param {string} announcedPostLink - Full SE API link object of the announced post
 * @param {number} announcedPostId - Question ID of the announced post
 * @param {number} hofAnswerId - Answer ID of the current HOF answer (used as the
 *   anchor link for the previous chunk when starting a new chunk)
 * @returns {string} Complete HOF markdown
 */
function assembleHallOfFamePage(existingEntries, newWinnerDataList, browsingLinks = {}, announcedContestNum = 0, announcedPostLink = '', announcedPostId = 0, hofAnswerId = 0) {
    console.log(`Assembling HOF with ${existingEntries.length} existing entries and ${newWinnerDataList.length} new entries`);
    
    // Merge and sort all real entries
    const allEntries = [...existingEntries];
    newWinnerDataList.forEach(winnerData => {
        allEntries.push({
            contestNum: winnerData.contestNum,
            winner: winnerData.winner,
            winnerHandle: winnerData.winnerHandle,
            winnerId: winnerData.winnerId,
            gameTags: winnerData.gameTags,
            upvotes: winnerData.upvotes,
            screenshotUrl: winnerData.screenshotUrl,
            screenshotAlt: winnerData.screenshotAlt,
            caption: winnerData.caption,
            dateRange: winnerData.dateRange,
            postId: winnerData.postId,
            contestLink: winnerData.contestLink || `//meta.arqade.com/q/${winnerData.postId}`,
            // Ties announce several winners; keep all of them
            winners: winnerData.winners || []
        });
    });
    
    allEntries.sort((a, b) => a.contestNum - b.contestNum);
    const allContestNums = allEntries.map(e => e.contestNum);
    console.log(`All contest numbers: ${allContestNums.join(', ')}`);
    
    // The page covers one 25-contest chunk: the chunk that contains the announced
    // contest (the next contest to be run). Deriving the range from the announced
    // contest means crossing a chunk boundary starts a fresh answer instead of
    // extending the completed previous chunk.
    const chunkAnchorNum = announcedContestNum > 0
        ? announcedContestNum
        : (allContestNums.length > 0 ? Math.max(...allContestNums) : 1);
    const rangeStart = Math.floor((chunkAnchorNum - 1) / 25) * 25 + 1;
    const rangeEnd = rangeStart + 24;
    const currentRangeKey = `${rangeStart}-${rangeEnd}`;
    
    // Fill in missing date ranges for real entries using an anchor entry. This
    // considers every parsed entry, including the completed previous chunk, so
    // the first contests of a fresh chunk still get a date.
    const anchorEntry = allEntries.slice().reverse().find(e => e.dateRange && parseContestStartDate(e.dateRange));
    let anchorDate = null;
    let anchorContestNum = 0;
    if (anchorEntry) {
        anchorDate = parseContestStartDate(anchorEntry.dateRange);
        anchorContestNum = anchorEntry.contestNum;
        allEntries.forEach(entry => {
            if (!entry.dateRange) {
                const offset = (entry.contestNum - anchorContestNum) * 14;
                const startDate = new Date(anchorDate);
                startDate.setDate(startDate.getDate() + offset);
                const endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 14);
                entry.dateRange = formatDateRange(startDate, endDate);
            }
        });
    }
    
    // Drop entries belonging to the completed previous chunk so they are not
    // repeated in the new chunk's answer.
    const previousChunkEntries = allEntries.filter(e => e.contestNum < rangeStart);
    const chunkEntries = allEntries.filter(e => e.contestNum >= rangeStart && e.contestNum <= rangeEnd);
    allEntries.length = 0;
    allEntries.push(...chunkEntries);
    console.log(`Chunk #${rangeStart}–#${rangeEnd}: keeping ${allEntries.length} entry(ies)`);
    
    // Build browsing links
    const allBrowsingLinks = {};
    Object.keys(browsingLinks).forEach(key => {
        allBrowsingLinks[key] = browsingLinks[key];
    });
    if (!allBrowsingLinks[currentRangeKey]) {
        allBrowsingLinks[currentRangeKey] = {
            start: rangeStart,
            end: rangeEnd,
            url: null,
            label: `#${rangeStart} – #${rangeEnd}`
        };
    }
    
    // If this is a new chunk and there were entries in the completed previous
    // chunk, that chunk now lives in the existing HOF answer. Point its range
    // link at that answer so the "Jump to" list still reaches it.
    if (previousChunkEntries.length > 0 && rangeStart > 25) {
        const previousKey = `${rangeStart - 25}-${rangeStart - 1}`;
        if (!allBrowsingLinks[previousKey] && hofAnswerId) {
            allBrowsingLinks[previousKey] = {
                start: rangeStart - 25,
                end: rangeStart - 1,
                url: `//meta.arqade.com/a/${hofAnswerId}`,
                label: `#${rangeStart - 25} – #${rangeStart - 1}`
            };
        }
    }
    
    // Helper: range label with spaced en-dashes
    const rangeLabel = (s, e) => `#${s} – #${e}`;
    
    // Generate header range links
    const sortedRanges = Object.values(allBrowsingLinks).sort((a, b) => a.start - b.start);
    let rangeLinks = "";
    for (let range of sortedRanges) {
        const label = rangeLabel(range.start, range.end);
        if (range.url) {
            rangeLinks += `**→ [${label}][${range.start}-${range.end}]**  \n`;
        } else if (range.start === rangeStart) {
            rangeLinks += `**→ ${label}** (You are here)  \n`;
        } else {
            rangeLinks += `**→ ${label}**  \n`;
        }
    }
    
    // ---- Generate entry markdown ----
    let entriesMarkdown = "";
    
    // Real entries — place separator between entries
    allEntries.forEach((entry, index) => {
        entriesMarkdown += generateEntryMarkdown(entry);

        // Separator between entries (not after the last one)
        if (index < allEntries.length - 1) {
            entriesMarkdown += `\n---\n\n`;
        }
    });
    
    // ---- Template entries ----
    // Template starts at announcedContestNum (the post just announced, whose contest number
    // is the NEXT contest to be run) and goes to rangeEnd
    const templateStartNum = announcedContestNum;
    const templateEndNum = rangeEnd;
    let templateMarkdown = "";
    
    if (templateStartNum <= templateEndNum) {
        templateMarkdown = `\n<!--- TEMPLATES START (move this line down)\n\n`;
        
        for (let num = templateStartNum; num <= templateEndNum; num++) {
            // Compute date for template entry
            let templateDate = `…`;
            if (anchorDate && anchorContestNum) {
                const offset = (num - anchorContestNum) * 14;
                const startDate = new Date(anchorDate);
                startDate.setDate(startDate.getDate() + offset);
                const endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 14);
                templateDate = formatDateRange(startDate, endDate);
            }
            
            templateMarkdown += `---\n\n### [Contest #${num}: \u2026][${num}-contest]\n`;
            templateMarkdown += `**Date:** ${templateDate}  \n`;
            templateMarkdown += `**Winner:** [\u2026] | **Game:** [tag:\u2026] | **Upvotes:** *\u2026*  \n`;
            templateMarkdown += `[![\u2026][${num}-img]][${num}-img]  \n`;
            templateMarkdown += `*\u2026*  \n\n`;
        }
        
        templateMarkdown += `TEMPLATES END --->`;
    }
    
    // ---- Jump to section ----
    let jumpToSection = `\n\n---\n\n**Jump to:**\n\n`;
    for (let range of sortedRanges) {
        const label = rangeLabel(range.start, range.end);
        if (range.url) {
            jumpToSection += `**→ [${label}][${range.start}-${range.end}]**  \n`;
        } else if (range.start === rangeStart) {
            jumpToSection += `**→ ${label}** (You are here)  \n`;
        } else {
            jumpToSection += `**→ ${label}**  \n`;
        }
    }
    
    // ---- Generate references ----
    let hofPostReferences = "";
    let userReferences = new Map();
    let contestReferences = "";
    let imageReferences = "";
    let templateUserReferenceCount = 0;
    
    // Build a set of all contest numbers (real entries + template range), sorted
    const allRefNums = new Set(allEntries.map(e => e.contestNum));
    if (templateStartNum <= templateEndNum) {
        for (let num = templateStartNum; num <= templateEndNum; num++) {
            allRefNums.add(num);
        }
    }
    const sortedRefNums = Array.from(allRefNums).sort((a, b) => a - b);
    
    // Lookup map for real entry data
    const entryByNum = {};
    allEntries.forEach(e => { entryByNum[e.contestNum] = e; });
    
    // Generate contest and image references in sorted order (real + template interleaved)
    sortedRefNums.forEach(num => {
        const entry = entryByNum[num];
        if (entry && entry.contestLink) {
            contestReferences += `  [${num}-contest]: ${entry.contestLink.replace(/^https?:/, '')}\n`;
        } else if (entry && entry.postId) {
            contestReferences += `  [${num}-contest]: //meta.arqade.com/q/${entry.postId}\n`;
        } else if (num === announcedContestNum && announcedPostLink) {
            const slugMatch = announcedPostLink.match(/\/questions\/\d+\/(.+)/);
            if (slugMatch) {
                contestReferences += `  [${num}-contest]: //meta.arqade.com/q/${announcedPostId}/${slugMatch[1]}\n`;
            } else {
                contestReferences += `  [${num}-contest]: //meta.arqade.com/q/${announcedPostId}\n`;
            }
        } else {
            contestReferences += `  [${num}-contest]: //meta.arqade.com/q/\u2026\n`;
        }
        
        const entryWinnerList = entry ? entryWinners(entry) : [];

        if (entryWinnerList.length > 1) {
            // Tied winners each keep their own screenshot reference
            entryWinnerList.forEach((winner, index) => {
                const url = winner.screenshotUrl && winner.screenshotUrl !== "N/A"
                    ? winner.screenshotUrl
                    : `https://i.sstatic.net/\u2026`;
                imageReferences += `  [${imageRefFor(num, index, entryWinnerList.length)}]: ${url}\n`;
            });
        } else if (entryWinnerList.length === 1 && entryWinnerList[0].screenshotUrl && entryWinnerList[0].screenshotUrl !== "N/A") {
            imageReferences += `  [${imageRefFor(num, 0, 1)}]: ${entryWinnerList[0].screenshotUrl}\n`;
        } else {
            imageReferences += `  [${imageRefFor(num, 0, 1)}]: https://i.sstatic.net/\u2026\n`;
            templateUserReferenceCount++;
        }
    });
    
    // Build user references from real entries (every tied winner needs one)
    allEntries.forEach(entry => {
        entryWinners(entry).forEach(winner => {
            const handle = winnerHandleOf(winner);
            const url = winner.userLink || (winner.userId ? `//arqade.com/users/${winner.userId}/${handle}?tab=profile` : `//arqade.com/users/\u2026`);
            if (!userReferences.has(handle)) {
                userReferences.set(handle, `  [${handle}]: ${url}`);
            }
        });
    });
    
    // Build user references string (real + template placeholders)
    let userReferencesStr = Array.from(userReferences.values()).join('\n');
    if (templateUserReferenceCount > 0) {
        userReferencesStr += '\n';
        for (let i = 0; i < templateUserReferenceCount; i++) {
            userReferencesStr += '  [\u2026]: //arqade.com/users/\u2026\n';
        }
    }
    
    // Add browsing link references
    for (let range of sortedRanges) {
        if (range.url) {
            hofPostReferences += `  [${range.start}-${range.end}]: ${range.url}\n`;
        }
    }
    
    // ---- Assemble final markdown ----
    const header = `## Screenshot of the Week Winners #${rangeStart} – #${rangeEnd}\n\n${rangeLinks}\n\n---\n\n`;
    
    const referencesSection = `\n\n<!-- HALL OF FAME POSTS -->\n\n${hofPostReferences}\n<!-- USERS -->\n\n${userReferencesStr}\n<!-- CONTESTS -->\n\n${contestReferences}\n<!-- SCREENSHOTS -->\n\n${imageReferences}`;
    
    return header + entriesMarkdown + templateMarkdown + jumpToSection + referencesSection;
}
