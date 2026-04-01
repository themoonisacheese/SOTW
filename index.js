// Tab switching functionality
document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
        const tabName = button.getAttribute('data-tab');
        
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.style.display = 'none';
        });
        
        // Remove active class from all buttons
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Show selected tab
        document.getElementById(tabName).style.display = 'block';
        button.classList.add('active');
    });
});

/**
 * API throttle management for Stack Exchange API compliance
 * Backoff is global — the SE API requires waiting before ANY subsequent request
 */
let apiBackoffUntil = 0;

async function waitForBackoff() {
    if (apiBackoffUntil > Date.now()) {
        const waitTime = Math.ceil((apiBackoffUntil - Date.now()) / 1000);
        console.log(`API throttle: waiting ${waitTime}s (global backoff)`);
        await new Promise(resolve => setTimeout(resolve, (apiBackoffUntil - Date.now()) + 100));
    }
}

function recordBackoff(backoffSeconds) {
    if (backoffSeconds && backoffSeconds > 0) {
        apiBackoffUntil = Date.now() + (backoffSeconds * 1000);
        console.log(`API global backoff recorded: ${backoffSeconds}s`);
    }
}

/**
 * Fetch with backoff handling
 */
async function fetchWithBackoff(url, endpoint) {
    // Wait for any global backoff
    await waitForBackoff();
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        // SE API returns errors as JSON with error_id even on 400/429 status codes
        if (data.error_id) {
            if (data.error_id === 502) {
                // Throttle violation — back off and retry once
                console.warn(`Rate limited (502). Backing off 10s before retry...`);
                recordBackoff(10);
                await waitForBackoff();
                const retryResponse = await fetch(url);
                const retryData = await retryResponse.json();
                if (retryData.error_id) {
                    throw new Error(`SE API error ${retryData.error_id}: ${retryData.error_message}`);
                }
                if (retryData.backoff) recordBackoff(retryData.backoff);
                return retryData;
            }
            throw new Error(`SE API error ${data.error_id} (${data.error_name}): ${data.error_message}`);
        }
        
        // Record backoff if present
        if (data.backoff) {
            recordBackoff(data.backoff);
        }
        
        return data;
    } catch (error) {
        console.error(`Fetch error for ${endpoint}:`, error);
        throw error;
    }
}

document.getElementById('autofetch').addEventListener('click', async () => {
    try {
        const previousIdInput = document.getElementById('previous-id').value.trim();
        let lastPost;

        if (previousIdInput) {
            // Fetch specific post by ID
            const specificPostApiUrl = `https://api.stackexchange.com/2.3/questions/${previousIdInput}?site=gaming.meta.stackexchange.com&filter=withbody`;
            const specificPostData = await fetchWithBackoff(specificPostApiUrl, 'questions');

            if (specificPostData.items && specificPostData.items.length > 0) {
                lastPost = specificPostData.items[0];
            } else {
                alert("No post found with the specified Previous ID.");
                return;
            }
        } else {
            // Fetch the last post matching criteria
            const twoWeeksAgo = new Date();
            twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 15); // Last 2 weeks + 1 day
            const fromDate = Math.floor(twoWeeksAgo.getTime() / 1000); // Convert to Unix timestamp

            const apiUrl = `https://api.stackexchange.com/2.3/questions?order=desc&sort=creation&tagged=screenshot-of-the-week;featured&site=gaming.meta.stackexchange.com&fromdate=${fromDate}&filter=withbody`;
            const data = await fetchWithBackoff(apiUrl, 'questions');

            if (data.items && data.items.length > 0) {
                lastPost = data.items[0];
            } else {
                alert("No posts found matching the criteria: posted in the last 2 weeks with the 'screenshot-of-the-week' and 'featured' tag.");
                return;
            }
        }

        const sotwNumberMatch = lastPost.title.match(/#(\d+)/); // Extract number after '#'
        const sotwNumber = sotwNumberMatch ? sotwNumberMatch[1] : "N/A";

        document.getElementById('sotw-number').value = sotwNumber;
        document.getElementById('previous-id').value = lastPost.question_id || "N/A";

        if (lastPost.accepted_answer_id) {
            const answerApiUrl = `https://api.stackexchange.com/2.3/answers/${lastPost.accepted_answer_id}?order=desc&sort=activity&site=gaming.meta.stackexchange.com&filter=withbody`;
            const answerData = await fetchWithBackoff(answerApiUrl, 'answers');

            if (answerData.items && answerData.items.length > 0) {
                const acceptedAnswer = answerData.items[0];
                processAnswers([acceptedAnswer], lastPost, sotwNumber);
            } else {
                alert("No accepted answer found for the post.");
            }
        } else {
            // Fetch all answers to detect ties (using upvotes only)
            const answersApiUrl = `https://api.stackexchange.com/2.3/questions/${lastPost.question_id}/answers?order=desc&sort=votes&site=gaming.meta.stackexchange.com&filter=withbody`;
            const answersData = await fetchWithBackoff(answersApiUrl, 'answers');

            if (answersData.items && answersData.items.length > 0) {
                // Find the maximum upvote count (using score as upvote metric)
                const maxUpvotes = Math.max(...answersData.items.map(answer => answer.score || 0));
                
                // Find all answers with the maximum upvote count (tied winners)
                const tiedAnswers = answersData.items.filter(answer => (answer.score || 0) === maxUpvotes);
                
                processAnswers(tiedAnswers, lastPost, sotwNumber);
            } else {
                alert("No answers found for the post.");
            }
        }

        function processAnswers(answers, post, sotwNumber) {
            const themeTitle = document.getElementById('theme-title').value.trim() || "There is no theme this week";
            const themeDescription = document.getElementById('theme-description').value.trim() || "There is no theme this week";

            // Call hoisted core function to generate template
            const result = processAnswersCore(answers, post, sotwNumber, themeTitle, themeDescription);
            const template = result.template;
            const metadata = result.metadata;

            // Parse first answer for screenshot and tags
            const parser = new DOMParser();
            const doc = parser.parseFromString(answers[0].body, "text/html");
            const tags = Array.from(doc.querySelectorAll("a.post-tag")).map(tag => tag.textContent).join(", ");

            // Update DOM with results
            const tiedCount = metadata.tiedCount;
            document.getElementById('winning-id').value = answers[0].answer_id || "N/A";
            document.getElementById('user').value = answers[0].owner.display_name || "N/A";
            document.getElementById('screenshot').value = metadata.screenshotUrl;
            document.getElementById('tag').value = tags || "N/A";
            document.getElementById('upvotes').value = metadata.upvoteCount + (tiedCount > 1 ? ` (${tiedCount}-way tie)` : "") || "N/A";

            // Set screenshot as page background
            if (metadata.screenshotUrl && metadata.screenshotUrl !== "N/A") {
                document.body.style.backgroundImage = `url('${metadata.screenshotUrl}')`;
            }

            // Display template in results
            document.getElementById('results').value = template;
            
            // Store the post ID in sessionStorage for hall of fame form
            const postId = post.question_id;
            sessionStorage.setItem('winning_post_id', postId);
            
            // Show notification with link to hall of fame form
            showNotificationWithLink(`Post generated! <a href="#" id="hof-link" style="color: white; text-decoration: underline;">Consider updating the hall of fame</a>.`);
        }
    } catch (error) {
        console.error("Error fetching data from Stack Exchange API:", error);
        alert("Failed to fetch data. Please try again later.");
    }
});

function showNotification(message) {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.position = 'fixed';
    notification.style.bottom = '10px';
    notification.style.right = '10px';
    notification.style.backgroundColor = '#4caf50';
    notification.style.color = 'white';
    notification.style.padding = '10px';
    notification.style.borderRadius = '5px';
    notification.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
    document.body.appendChild(notification);

    setTimeout(() => {
        document.body.removeChild(notification);
    }, 3000);
}

function showNotificationWithLink(htmlContent) {
    const notification = document.createElement('div');
    notification.innerHTML = htmlContent;
    notification.style.position = 'fixed';
    notification.style.bottom = '10px';
    notification.style.right = '10px';
    notification.style.backgroundColor = '#4caf50';
    notification.style.color = 'white';
    notification.style.padding = '10px';
    notification.style.borderRadius = '5px';
    notification.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
    notification.style.zIndex = '10000';
    document.body.appendChild(notification);
    
    // Attach click handler to the link
    const hofLink = notification.querySelector('#hof-link');
    if (hofLink) {
        hofLink.addEventListener('click', (e) => {
            e.preventDefault();
            // Switch to hall of fame tab
            const hofTabButton = document.querySelector('[data-tab="hof-tab"]');
            hofTabButton.click();
            // Auto-populate the post ID
            const postId = sessionStorage.getItem('winning_post_id');
            if (postId) {
                document.getElementById('hof-post-id').value = postId;
            }
        });
    }
}


document.getElementById('copy-post').addEventListener('click', () => {
    const results = document.getElementById('results');
    navigator.clipboard.writeText(results.value);
    showNotification('Post copied to clipboard!');
});


document.getElementById('toggle-more-info').addEventListener('click', () => {
    const moreInfo = document.getElementById('more-info');
    if (moreInfo.style.display === 'none' || moreInfo.style.display === '') {
        moreInfo.style.display = 'block';
    } else {
        moreInfo.style.display = 'none';
    }
});

document.getElementById('view-screenshot').addEventListener('click', () => {
    const screenshotUrl = document.getElementById('screenshot').value.trim();
    if (screenshotUrl && screenshotUrl !== "N/A") {
        window.open(screenshotUrl, '_blank');
    } else {
        alert("No valid screenshot URL available.");
    }
});
