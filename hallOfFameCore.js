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
                
                // Skip template entries (have ": …" suffix after contest number)
                const link = h3.querySelector("a");
                const linkText = link ? link.textContent : h3.textContent;
                if (linkText.includes(': …') || linkText.includes('...')) {
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
function parseHallOfFameEntry(contestNum, htmlContent) {
    const entry = {
        contestNum: contestNum,
        winner: "Unknown",
        winnerHandle: "",
        winnerId: 0,
        gameTags: [],
        upvotes: 0,
        screenshotUrl: "N/A",
        screenshotAlt: "",
        caption: "",
        dateRange: "",
        postId: 0,
        userLink: ""
    };
    
    try {
        // Parse the HTML content
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, "text/html");
        
        // Extract date range from <strong>Date:</strong> text
        const pElements = doc.querySelectorAll("p");
        let dateFound = false;
        let winnerFound = false;
        
        pElements.forEach(p => {
            const text = p.textContent;
            
            if (!dateFound && text.includes("Date:")) {
                const dateMatch = text.match(/Date:\s*([^|]+?)(?:\||$)/);
                if (dateMatch) {
                    entry.dateRange = dateMatch[1].trim();
                    dateFound = true;
                    console.log(`  #${contestNum} - Date: ${entry.dateRange}`);
                }
            }
            
            if (!winnerFound && text.includes("Winner:")) {
                // Get winner name and ID from link that comes after "Winner:"
                let nextIsWinner = false;
                
                for (let elem of p.childNodes) {
                    if (elem.nodeName === "STRONG" && elem.textContent === "Winner:") {
                        nextIsWinner = true;
                    } else if (nextIsWinner && elem.nodeName === "A") {
                        entry.winner = elem.textContent.trim();
                        entry.winnerHandle = elem.textContent.trim().toLowerCase().replace(/\s+/g, '-');
                        
                        // Extract user ID from href: //arqade.com/users/5357/neon1024?tab=profile
                        const href = elem.href || elem.getAttribute('href') || '';
                        entry.userLink = href.replace(/^https?:/, '');
                        const userIdMatch = href.match(/\/users\/(\d+)/);
                        if (userIdMatch) {
                            entry.winnerId = parseInt(userIdMatch[1], 10);
                            console.log(`  #${contestNum} - Winner: ${entry.winner} (ID: ${entry.winnerId})`);
                        } else {
                            console.log(`  #${contestNum} - Winner: ${entry.winner}`);
                        }
                        winnerFound = true;
                        break;
                    }
                }
            }
            
            // Extract game tags from links with class "post-tag"
            const tagLinks = p.querySelectorAll("a.post-tag, a.s-tag.post-tag");
            tagLinks.forEach(link => {
                let gameTag = link.textContent.trim();
                // Handle both "game-name" and "Game Name" formats
                if (gameTag && !entry.gameTags.includes(gameTag)) {
                    entry.gameTags.push(gameTag);
                }
            });
            
            // Extract upvotes from "Upvotes: *XX*" pattern
            if (text.includes("Upvotes:")) {
                const upvotesMatch = text.match(/Upvotes:\s*\*?(\d+)\*?/);
                if (upvotesMatch) {
                    entry.upvotes = parseInt(upvotesMatch[1], 10);
                }
            }
        });
        
        // Extract screenshot image or link
        const images = doc.querySelectorAll("img");
        if (images.length > 0) {
            entry.screenshotUrl = images[0].src;
            entry.screenshotAlt = images[0].alt || "";
        }
        
        // Extract caption from the image's paragraph (markdown line breaks render as <br>, not <p>)
        // So the caption <em> is inside the same <p> as the <img>
        let caption = "";
        
        if (images.length > 0) {
            const imgParagraph = images[0].closest("p");
            if (imgParagraph) {
                // Find the image link (usually wrapped in <a>)
                const imgLink = images[0].closest("a");
                const reference = imgLink || images[0];
                
                // Find ALL <em> and <i> tags, then get the one that comes AFTER the image
                // (there's usually an <em> for upvote count before the image, and <em> for caption after)
                const emTags = imgParagraph.querySelectorAll("em, i");
                for (let emTag of emTags) {
                    // Check if this em tag comes after the image in the paragraph
                    // by comparing their positions in childNodes
                    if (reference.compareDocumentPosition(emTag) & Node.DOCUMENT_POSITION_FOLLOWING) {
                        caption = emTag.textContent.trim();
                        break;
                    }
                }
            }
            
            // Fallback: if no em tag found after image, look in next paragraphs
            if (!caption) {
                const paragraphs = doc.querySelectorAll("p");
                for (let i = 0; i < paragraphs.length; i++) {
                    if (paragraphs[i].contains(images[0])) {
                        for (let j = i + 1; j < paragraphs.length; j++) {
                            const textContent = paragraphs[j].textContent.trim();
                            // Skip empty paragraphs, dividers, and upvote lines
                            if (textContent.length > 0 && textContent !== "---" && !textContent.includes("Upvotes:")) {
                                caption = textContent;
                                break;
                            }
                        }
                        break;
                    }
                }
            }
        }
        
        entry.caption = caption;
        
        if (caption) {
            console.log(`  #${contestNum} - Caption: ${caption.substring(0, 50)}...`);
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
    const firstMissing = lastContestNum + 1;
    const lastMissing = announcedContestNum - 1;
    
    if (firstMissing > lastMissing) {
        // No missing contests
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
 * Extract winner information from a SOTW post body
 * All SOTW posts now use processAnswersCore, so we know the exact format
 */
async function extractWinnerFromPost(post, contestNum) {
    try {
        const body = post.body;
        
        if (!body) {
            console.warn(`No body content for post ${post.question_id} (contest #${contestNum})`);
            return null;
        }
        
        // Parse the HTML body
        const parser = new DOMParser();
        const doc = parser.parseFromString(body, "text/html");
        
        // Get the full text content - handle case where doc.body might be null
        let fullText = "";
        if (doc.body) {
            fullText = doc.body.textContent || "";
        } else {
            // Fallback: try to get text directly from document
            fullText = doc.documentElement.textContent || "";
        }
        
        if (!fullText || fullText.length === 0) {
            console.warn(`Could not extract text from post body for contest #${contestNum}`);
            return null;
        }
        
        // Try multiple patterns for winner extraction
        let winner = "";
        let winnerHandle = "";
        let winnerId = 0;
        
        // First, try to extract user ID from HTML links (like <a href="//arqade.com/users/5357/name">)
        const allLinks = doc.querySelectorAll("a");
        for (let link of allLinks) {
            const href = link.href || link.getAttribute('href') || '';
            if (href.includes('/users/')) {
                const userIdMatch = href.match(/\/users\/(\d+)/);
                if (userIdMatch) {
                    winnerId = parseInt(userIdMatch[1], 10);
                    winner = link.textContent.trim();
                    winnerHandle = winner.toLowerCase().replace(/\s+/g, '-');
                    console.log(`Extracted winner from HTML: ${winner} (ID: ${winnerId})`);
                    break;
                }
            }
        }
        
        // If HTML extraction failed, try text-based patterns
        if (!winner) {
            // Pattern 1: Markdown link format [Winner Name][handle]'s screenshot
            let winnerMatch = fullText.match(/\[([^\]]+)\]\[([^\]]+)\]'s screenshot/i);
            
            if (winnerMatch) {
                winner = winnerMatch[1];
                winnerHandle = winnerMatch[2];
            } else {
                // Pattern 2: Plain text format with game name: "Name's screenshot ... from game-name ... won with upvotes"
                // Updated to handle multi-word names like "Tobias F." with spaces and periods
                winnerMatch = fullText.match(/([A-Za-z][A-Za-z0-9\s.'-]*?)'s screenshot.*?from\s+([\w\-]+).*?won with\s+(\d+)\s+upvotes?/is);
                
                if (winnerMatch) {
                    winner = winnerMatch[1].trim();
                    winnerHandle = winner.toLowerCase().replace(/\s+/g, '-');
                } else {
                    // Pattern 3: Fallback - just find the first capitalized name before "'s screenshot"
                    // Updated to handle multi-word names like "Tobias F."
                    winnerMatch = fullText.match(/([A-Za-z][A-Za-z0-9\s.'-]*?)'s screenshot/i);
                    if (winnerMatch) {
                        winner = winnerMatch[1].trim();
                        winnerHandle = winner.toLowerCase().replace(/\s+/g, '-');
                    }
                }
            }
        }
        
        if (!winner) {
            console.warn(`Could not extract winner from contest #${contestNum}. Pattern not found in: ${fullText.substring(0, 300)}`);
            return null;
        }
        
        // Extract upvote count: "won with (\d+) upvotes"
        const upvotesMatch = fullText.match(/won with\s+(\d+)\s+upvotes?/i);
        const upvotes = upvotesMatch ? parseInt(upvotesMatch[1], 10) : 0;
        
        // Extract game tags: try both [tag:game-name] and plain "from game-name" format
        let gameTags = [];
        
        // Pattern 1: Markdown [tag:game-name] format
        const tagsMatches = fullText.matchAll(/\[tag:([^\]]+)\]/g);
        for (const tagMatch of tagsMatches) {
            gameTags.push(tagMatch[1]);
        }
        
        // Pattern 2: Plain text "from game-name" format (already captured in winner match if plain text)
        if (gameTags.length === 0) {
            const plainTagMatch = fullText.match(/from\s+([\w\-]+)/i);
            if (plainTagMatch) {
                gameTags.push(plainTagMatch[1]);
            }
        }
        
        // Extract date range: "Date: X–Y of Month, Year"
        const dateMatch = fullText.match(/Date:\s*([^\n]+?)(?:\n|$)/);
        let dateRange = "";
        if (dateMatch) {
            dateRange = dateMatch[1].trim();
        }
        
        // Extract screenshot URL from first image
        const images = doc.querySelectorAll("img");
        let screenshotUrl = "N/A";
        let screenshotAlt = "";
        
        if (images.length > 0) {
            screenshotUrl = images[0].src;
            screenshotAlt = images[0].alt || "";
        }
        
        // Extract caption: text between screenshot and "---" (for pure text), or next paragraph (for HTML)
        // First try text-based extraction (for markdown-like content)
        let captionMatch = fullText.match(/!\[([^\]]*)\]\[(\d+)-img\]\n(.*?)(?:\n---|$)/s);
        let caption = "";
        
        if (captionMatch && captionMatch[3]) {
            caption = captionMatch[3].trim();
            // Remove "---" if present
            if (caption.startsWith('---')) {
                caption = caption.replace(/^---\s*/, '').trim();
            }
        }
        
        // Caption is in the winning answer body, not the announcement post.
        // Find the link to the winning answer: https://gaming.meta.stackexchange.com/a/ANSWER_ID
        let winningAnswerId = null;
        const postLinks = doc.querySelectorAll("a");
        for (let link of postLinks) {
            const href = link.href || link.getAttribute('href') || '';
            const answerMatch = href.match(/gaming\.meta\.stackexchange\.com\/a\/(\d+)/);
            if (answerMatch) {
                winningAnswerId = answerMatch[1];
                break;
            }
        }
        
        if (winningAnswerId) {
            try {
                const answerUrl = `https://api.stackexchange.com/2.3/answers/${winningAnswerId}?site=gaming.meta.stackexchange.com&filter=withbody`;
                const answerData = await fetchWithBackoff(answerUrl, 'answers');
                if (answerData.items && answerData.items.length > 0) {
                    const answerItem = answerData.items[0];
                    const answerBody = answerItem.body;
                    
                    // Extract user ID from answer owner if we don't have it yet
                    if (!winnerId && answerItem.owner && answerItem.owner.user_id) {
                        winnerId = answerItem.owner.user_id;
                        console.log(`Extracted winner ID from answer author: ${winnerId}`);
                    }
                    
                    const answerDoc = new DOMParser().parseFromString(answerBody, "text/html");
                    const answerImages = answerDoc.querySelectorAll("img");
                    
                    if (answerImages.length > 0) {
                        console.log(`Found ${answerImages.length} images in winning answer for contest #${contestNum}`);
                        
                        const answerParagraphs = answerDoc.querySelectorAll("p");
                        let imageParaIndex = -1;
                        
                        // Find which paragraph contains the image
                        for (let i = 0; i < answerParagraphs.length; i++) {
                            if (answerParagraphs[i].contains(answerImages[0])) {
                                imageParaIndex = i;
                                break;
                            }
                        }
                        
                        if (imageParaIndex >= 0) {
                            const imgParagraph = answerParagraphs[imageParaIndex];
                            
                            // Caption is typically in <em>, <i>, or <b> inside or just before the image's paragraph
                            // First try to find it within the image paragraph
                            let em = imgParagraph.querySelector("em, i, b");
                            if (em) {
                                caption = em.textContent.trim();
                                console.log(`Found caption in image paragraph tag: "${caption}"`);
                            }
                            
                            // If not found in tags, try looking in the PREVIOUS paragraph (caption often comes before image)
                            if (!caption && imageParaIndex > 0) {
                                const prevPara = answerParagraphs[imageParaIndex - 1];
                                const prevText = prevPara.textContent.trim();
                                // Check if this looks like a caption (not too long, reasonable format)
                                if (prevText && prevText.length > 0 && prevText.length < 500 && prevText !== "---") {
                                    caption = prevText;
                                    console.log(`Found caption in previous paragraph: "${caption}"`);
                                }
                            }
                            
                            // If still no caption, look in next paragraph
                            if (!caption && imageParaIndex < answerParagraphs.length - 1) {
                                const nextPara = answerParagraphs[imageParaIndex + 1];
                                const nextText = nextPara.textContent.trim();
                                if (nextText && nextText.length > 0 && nextText.length < 500 && nextText !== "---") {
                                    caption = nextText;
                                    console.log(`Found caption in next paragraph: "${caption}"`);
                                }
                            }
                        }
                    } else {
                        console.log(`No images found in winning answer for contest #${contestNum}`);
                    }
                }
            } catch (e) {
                console.warn(`Could not fetch winning answer ${winningAnswerId} for caption:`, e);
            }
        }
        
        console.log(`Caption for contest #${contestNum}: "${caption}"`);
        
        // Build the contest link in HOF format: //meta.arqade.com/q/ID/slug
        // SE API gives links like https://gaming.meta.stackexchange.com/questions/ID/slug
        // HOF uses //meta.arqade.com/q/ID/slug
        let contestLink = `//meta.arqade.com/q/${post.question_id}`;
        if (post.link) {
            const slugMatch = post.link.match(/\/questions\/\d+\/(.+)/);
            if (slugMatch) {
                contestLink = `//meta.arqade.com/q/${post.question_id}/${slugMatch[1]}`;
            }
        }
        
        return {
            contestNum: contestNum,
            contestLink: contestLink,
            winner: winner,
            winnerHandle: winnerHandle,
            winnerId: winnerId,
            gameTags: gameTags,
            upvotes: upvotes,
            screenshotUrl: screenshotUrl,
            screenshotAlt: screenshotAlt,
            caption: caption,
            dateRange: dateRange,
            postId: post.question_id
        };
    } catch (error) {
        console.error(`Error extracting winner from contest #${contestNum}:`, error);
        return null;
    }
}

/**
 * Generate a Hall of Fame entry markdown for a single winner
 */
function generateWinnerEntry(winnerData) {
    const { contestNum, winner, winnerHandle, winnerId, gameTags, upvotes, screenshotUrl, screenshotAlt, caption, dateRange, postId } = winnerData;
    
    const gameTagsMarkdown = gameTags.map(tag => `[tag:${tag}]`).join(' ');
    const winnerHandleForLink = winnerHandle || winner.toLowerCase().replace(/\s+/g, '-');
    
    let entryMarkdown = `### [Contest #${contestNum}][${contestNum}-contest]\n`;
    
    if (dateRange) {
        entryMarkdown += `**Date:** ${dateRange}\n`;
    }
    
    entryMarkdown += `**Winner:** [${winner}][${winnerHandleForLink}] | **Game:** ${gameTagsMarkdown} | **Upvotes:** *${upvotes}*\n`;
    
    if (screenshotUrl && screenshotUrl !== "N/A") {
        const altText = screenshotAlt || `Contest #${contestNum} winning screenshot`;
        entryMarkdown += `[![${altText}][${contestNum}-img]][${contestNum}-img]\n`;
        
        if (caption) {
            entryMarkdown += `*${caption}*\n`;
        }
    }
    
    // Use winnerId for the user reference link if available, otherwise use placeholder
    const userLinkTarget = winnerId ? `//arqade.com/users/${winnerId}/${winnerHandle}` : `//arqade.com/users/0`;
    
    return {
        markdown: entryMarkdown,
        referenceLink: `  [${contestNum}-contest]:       //meta.arqade.com/q/${postId}`,
        imageReference: screenshotUrl && screenshotUrl !== "N/A" ? `  [${contestNum}-img]:           ${screenshotUrl}` : null,
        userReference: `  [${winnerHandleForLink}]:       ${userLinkTarget}`
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
 * @returns {string} Complete HOF markdown
 */
function assembleHallOfFamePage(existingEntries, newWinnerDataList, browsingLinks = {}, announcedContestNum = 0, announcedPostLink = '', announcedPostId = 0) {
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
            contestLink: winnerData.contestLink || `//meta.arqade.com/q/${winnerData.postId}`
        });
    });
    
    allEntries.sort((a, b) => a.contestNum - b.contestNum);
    const allContestNums = allEntries.map(e => e.contestNum);
    console.log(`All contest numbers: ${allContestNums.join(', ')}`);
    
    const minContestNum = allContestNums.length > 0 ? Math.min(...allContestNums) : announcedContestNum;
    const maxContestNum = allContestNums.length > 0 ? Math.max(...allContestNums) : announcedContestNum;
    
    // Find range boundaries (25-entry chunks)
    const rangeStart = Math.floor((minContestNum - 1) / 25) * 25 + 1;
    const rangeEnd = Math.ceil(maxContestNum / 25) * 25;
    const currentRangeKey = `${rangeStart}-${rangeEnd}`;
    
    // Fill in missing date ranges for real entries using anchor entry
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
        entriesMarkdown += `### [Contest #${entry.contestNum}][${entry.contestNum}-contest]\n`;
        if (entry.dateRange) {
            entriesMarkdown += `**Date:** ${entry.dateRange}  \n`;
        }
        const gameTagsMarkdown = entry.gameTags.map(tag => `[tag:${tag}]`).join(' ');
        const winnerHandleForLink = entry.winnerHandle || entry.winner.toLowerCase().replace(/\s+/g, '-');
        entriesMarkdown += `**Winner:** [${entry.winner}][${winnerHandleForLink}] | **Game:** ${gameTagsMarkdown} | **Upvotes:** *${entry.upvotes}*  \n`;
        if (entry.screenshotUrl && entry.screenshotUrl !== "N/A") {
            const altText = entry.screenshotAlt || `Contest #${entry.contestNum} winning screenshot`;
            entriesMarkdown += `[![${altText}][${entry.contestNum}-img]][${entry.contestNum}-img]\n`;
            if (entry.caption) {
                entriesMarkdown += `*${entry.caption}*  \n`;
            }
        }
        
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
        
        if (entry && entry.screenshotUrl && entry.screenshotUrl !== "N/A") {
            imageReferences += `  [${num}-img]: ${entry.screenshotUrl}\n`;
        } else {
            imageReferences += `  [${num}-img]: https://i.sstatic.net/\u2026\n`;
            templateUserReferenceCount++;
        }
    });
    
    // Build user references from real entries
    allEntries.forEach(entry => {
        const handle = entry.winnerHandle || entry.winner.toLowerCase().replace(/\s+/g, '-');
        const url = entry.userLink || (entry.winnerId ? `//arqade.com/users/${entry.winnerId}/${handle}?tab=profile` : `//arqade.com/users/\u2026`);
        if (!userReferences.has(handle)) {
            userReferences.set(handle, `  [${handle}]: ${url}`);
        }
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
