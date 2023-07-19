import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import CodeMirror from 'codemirror';
import 'codemirror/mode/javascript/javascript.js';
import 'codemirror/addon/search/searchcursor.js';

import { init, embed } from '@lizozom/semanticjs';
import { splitText } from './split_text.js';
import { calculateCosineSimilarity } from './similarity.js';

import '../css/styles.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'codemirror/lib/codemirror.css';

/**
 * @type {Array<*>}
 */
let markers = [];
/**
 * @type {CodeMirror.EditorFromTextArea}
 */
let editor;
let submitTime = 0;
let isProcessing = false;
let selectedIndex = -1;
/** @type {string} */
let selectedClassName = "";
/** @type {*} */
let prevCard;
const nextButton = /** @type {HTMLElement} */ (document.getElementById("next"));
const prevButton = /** @type {HTMLElement} */ (document.getElementById("prev"));
const submitButton = /** @type {HTMLElement} */ (document.getElementById("submit_button"));
const resultsList = /** @type {HTMLElement} */ (document.getElementById('results-list'));
const thresholdEl = /** @type {HTMLInputElement} */ (document.getElementById("threshold"));
const progressBar = /** @type {HTMLInputElement} */ (document.getElementById("progressBarProgress"));
const downloadBar = /** @type {HTMLInputElement} */ (document.getElementById("loading-progress"));
const inputQueryEl = /** @type {HTMLInputElement} */ (document.getElementById("query-text"));
const inputTextEl = /** @type {HTMLTextAreaElement} */ (document.getElementById("input-text")); 
const splitTypeEl = /** @type {HTMLInputElement} */ (document.getElementById("split-type"));
const splitParamEl = /** @type {HTMLInputElement} */ (document.getElementById("split-param"));
const modelNameEl = /** @type {HTMLInputElement} */ (document.getElementById("model-name"));

function removeHighlights() {
    for (let marker of markers) {
        marker.clear();
    }
    markers = [];
}

function deactivateSubmitButton() {
    submitButton.setAttribute("disabled", "");
    submitButton.textContent = "Loading...";
}

function activateSubmitButton() {
    submitButton.removeAttribute("disabled");
    submitButton.textContent = "Submit";
}

function finishCallback() {
    submitButton.textContent = "Submit";
    isProcessing = false;
    const processTime = new Date().getTime() - submitTime;
    console.log(`Finished ${processTime}ms`);

    activateScrollButtons();
}

async function onSubmit() {
    if (!isProcessing) {
        submitTime = new Date().getTime();
        isProcessing = true;
        submitButton.textContent = "Stop";

        resultsList.innerHTML = '';
        selectedIndex = -1;
        await semanticHighlight(finishCallback);
    } else {
        submitButton.textContent = "Submit"
        isProcessing = false;
    }
}

function resetResults() {
    // Remove previous highlights
    removeHighlights();

    // Get results list element
    resultsList.innerHTML = '';
}

/**
 *
 * @param {*} results
 */
function updateResults(results) {
    resetResults();
    const k = Number(thresholdEl.value);

    for (let i = 0; i < Math.min(k, results.length); i++) {
        let resultItem = results[i];

        let highlightClass;
        if (i === 0) highlightClass = "highlight-first";
        else if (i === 1) highlightClass = "highlight-second";
        else highlightClass = "highlight-third";

        createHighlight(resultItem[0], highlightClass, resultItem[1]);

    }
}

/**
 * @param {string} text
 * @param {string} className
 * @param {number} similarity
 */
function createHighlight(text, className, similarity) {
    const cursor = editor.getSearchCursor(text);

    while (cursor.findNext()) {
        let marker = editor.markText(cursor.from(), cursor.to(), { className: className });
        markers.push(marker);

        // create card
        let listItem = document.createElement('div');
        listItem.classList.add('card');
        listItem.innerHTML = createCardHTML(text, similarity);

        resultsList.appendChild(listItem);

        let index = resultsList.childElementCount - 1;

        // Add click listener for card
        listItem.addEventListener('click', function () {
            const foundMarkers = markers[index].find();
            editor.scrollIntoView(foundMarkers);
            highlightSelected(index);
        });
    }
}

/**
 * @param {string} title
 * @param {number} similarity
 * @returns
 */
function createCardHTML(title, similarity) {
    return `
        <div class="card-body">
            <h5 class="card-title">${title}</h5>
            <h6 class="card-subtitle mb-2 text-muted">similarity: ${similarity.toFixed(2)}</h6>
        </div>
    `;
}

/**
 *
 * @param {number} index
 */
function highlightSelected(index) {
    highlightCard(index);
    if (selectedIndex !== -1) {
        let marker0 = editor.markText(markers[selectedIndex].find().from, markers[selectedIndex].find().to, { className: selectedClassName });
        markers[selectedIndex].clear();
        markers[selectedIndex] = marker0;
    }

    selectedIndex = index;
    selectedClassName = markers[selectedIndex].className;

    let marker1 = editor.markText(markers[selectedIndex].find().from, markers[selectedIndex].find().to, { className: "highlight-select" });
    markers[selectedIndex].clear();
    markers[selectedIndex] = marker1;
}
/**
 * @param {number} index
 */
function highlightCard(index) {
    let cards = resultsList.getElementsByClassName('card');

    // Ensure the index is within the range of the cards.
    if (prevCard) {
        prevCard.style.backgroundColor = '';
    }
    prevCard = cards[index];

    // @ts-ignore
    cards[index].style.backgroundColor = '#f4ac90';
}

/**
 * @param {*} value 
 */
function setProgressBarValue(value) {
    if (value === "" || value == "0") {
        progressBar.style.transition = 'width .1s ease'; // Temporarily override the transition duration
        progressBar.classList.add('progress-bar-animated');
        progressBar.classList.add('progress-bar-striped');
    } else {
        progressBar.style.transition = ''; // Restore the original transition
    }
    //@ts-ignore
    progressBar.parentNode.setAttribute('aria-valuenow', value);


    if (value == 100) {
        progressBar.classList.remove('progress-bar-animated');
        progressBar.classList.remove('progress-bar-striped');
    }
}

/**
 * @param {Function} callback 
 */
async function semanticHighlight(callback) {
    deactivateScrollButtons();
    resetResults();
    setProgressBarValue(0);

    // query input embedding
    const text = editor.getValue("");
    const inputQuery = inputQueryEl.value;
    const splitType = splitTypeEl.value;
    const splitParam =splitParamEl.value;
    const inputTexts = await splitText(text, splitType, splitParam);

    const embeddedQuery = await embed(inputQuery);

    /** @type {Array<[string, number]>} */
    let results = [];

    // Only update results a max of num_updates times
    let num_updates = 100;
    let N = inputTexts.length;
    let interval = Math.ceil(N / Math.min(num_updates, N));

    for (let i = 0; i < N; i++) {
        let inputText = inputTexts[i];
        if (!isProcessing) {
            break;
        }

        const embeddedText = await embed(inputText);

        const cosineSimilarity = await calculateCosineSimilarity(embeddedQuery, embeddedText);

        results.push([inputText, cosineSimilarity]);

        if (i % interval === 0 || i === N - 1) {
            results.sort((a, b) => b[1] - a[1]);

            updateResults(results);
            if (markers.length > 0 && (selectedIndex === -1 || selectedIndex === 0)) {
                editor.scrollIntoView(markers[0].find());
            }

            let progress = Math.round(((i + 1) * 100) / N);
            setProgressBarValue(progress);
        }
    }

    callback();
}

function activateScrollButtons() {
    // Enable the next and prev buttons
    nextButton.removeAttribute("disabled");
    prevButton.removeAttribute("disabled");
}

function deactivateScrollButtons() {
    // Disable the next and prev buttons
    nextButton.setAttribute("disabled", "");
    prevButton.setAttribute("disabled", "");
}

function nextMarker() {
    if (selectedIndex === -1) {
        highlightSelected(0);

    } else {
        highlightSelected((selectedIndex + 1) % markers.length);
        editor.scrollIntoView(markers[selectedIndex].find());
    }
}

function prevMarker() {
    if (selectedIndex === -1) {
        highlightSelected(0);

    } else {
        highlightSelected((selectedIndex - 1 + markers.length) % markers.length);
        editor.scrollIntoView(markers[selectedIndex].find());
    }
}

// /**
//  * @param {*} progressMessage 
//  */
// const onModelLoadProgress = (progressMessage) => {
//     const { file, status, progress } = progressMessage;
//     if (file === "onnx/model_quantized.onnx") {
//         switch (status) {
//             case 'progress': 
//                 const rProgress = progress.toFixed(2);
//                 downloadBar.style.width = `${rProgress}%`;
//                 downloadBar.textContent = `${rProgress}%`;
//                 downloadBar.setAttribute('aria-valuenow', rProgress);
//                 break;
//             case 'ready':
//                 downloadBar.style.width = '100%';
//                 downloadBar.setAttribute('aria-valuenow', '100');
//                 downloadBar.textContent = "";
//                 break;
//         }
//     }
// }

/**
 * @param {*} progressMessage 
 */
const onModelLoadProgress = (progressMessage) => {
    const { file, status, progress } = progressMessage;
    if (file === "onnx/model_quantized.onnx") {
        switch (status) {
            case 'progress': 
                const rProgress = progress.toFixed(2);
                downloadBar.style.width = `${rProgress}%`;
                downloadBar.textContent = `${rProgress}%`;
                downloadBar.setAttribute('aria-valuenow', rProgress);
                break;
            case 'ready':
                downloadBar.style.width = '100%';
                downloadBar.setAttribute('aria-valuenow', '100');
                downloadBar.textContent = "";
                break;
        }
    }
}

/**
 * Setup the application when the page loads.
 */
window.onload = async function () {
    editor = CodeMirror.fromTextArea(inputTextEl, {
        lineNumbers: true,
        mode: 'text/plain',
        lineWrapping: true,
    });

    modelNameEl.addEventListener('change', async function() {
        deactivateSubmitButton();
        setProgressBarValue(0);
        var model_name = this.value;
        await init({ modelName: model_name}, onModelLoadProgress);
        activateSubmitButton();
    });

    submitButton.addEventListener('click', (e) => {
        e.preventDefault();
        onSubmit();
    });

    splitTypeEl.addEventListener('change', function() {
        // Get the selected option value
        const splitParamLabel = /** @type {HTMLInputElement} */ (document.querySelector("label[for='split-param']"));
        switch (this.value) {
            case "Words":
                splitParamEl.disabled = false;
                splitParamLabel.textContent = "# Words";
                splitParamEl.type = 'number';
                splitParamEl.value = "7";
                splitParamEl.min = "1";
                break;
            case "Tokens":
                splitParamEl.disabled = false;
                splitParamLabel.textContent = "# Tokens";
                splitParamEl.type = 'number';
                splitParamEl.value = "15";
                splitParamEl.min = "1";
                splitParamEl.max = "512";
                break;
            case "Chars":
                splitParamEl.disabled = false;
                splitParamLabel.textContent = "# Chars";
                splitParamEl.type = 'number';
                splitParamEl.value = "40";
                splitParamEl.min = "1";
                break;
            case "Regex":
                splitParamEl.disabled = false;
                splitParamLabel.textContent = "Regex";
                splitParamEl.type = 'text';
                splitParamEl.value = "[.,]\\s";
                break;
            default:
                splitParamEl.value = "";
                splitParamEl.disabled = true;
                splitParamLabel.textContent = "";
                splitParamEl.placeholder = "";
        }
    });


    const accordionButton = /** @type {HTMLButtonElement} */ (document.querySelector('.accordion-button'));
    accordionButton.addEventListener('click', function() {
        var isExpanded = accordionButton.getAttribute('aria-expanded') === 'true';

        if(isExpanded) {
            accordionButton.textContent = 'Settings ↡';
        } else {
            accordionButton.textContent = 'Settings ↠';
        }
    });

    let model_name = modelNameEl.value;
    await init({ modelName: model_name}, onModelLoadProgress);
    activateSubmitButton();

    const nextBtn = /** @type {HTMLButtonElement} */ (document.getElementById('next'));
    const prevBtn = /** @type {HTMLButtonElement} */ (document.getElementById('prev'));
    nextBtn.addEventListener('click', function (event) {
        event.preventDefault();
        nextMarker();
    });

    prevBtn.addEventListener('click', function (event) {
        event.preventDefault();
        prevMarker();
    });
};
