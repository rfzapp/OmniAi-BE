import assert from "node:assert/strict";
import test from "node:test";
import { isImageCapabilityQuestion, mayHaveImageIntent } from "./image-intent";

test("does not classify ordinary chat messages", () => {
  for (const message of ["Hi", "Hello there", "Thanks!", "What is the capital of France?"]) {
    assert.equal(mayHaveImageIntent(message), false, message);
  }
});

test("classifies image requests and likely image edits", () => {
  for (const message of [
    "I want a picture of a mountain",
    "Draw a dragon",
    "Make a banner for my channel",
    "Please remove the background",
    "Make it brighter",
    "Change this image to a watercolor style",
  ]) {
    assert.equal(mayHaveImageIntent(message), true, message);
  }
});

test("does not classify unrelated edits", () => {
  assert.equal(mayHaveImageIntent("Change my password"), false);
});

test("recognizes generic image-generation capability questions", () => {
  for (const message of [
    "Can you generate an image?",
    "Could you create a picture?",
    "Do you support image generation?",
    "Can you make an image for me?",
  ]) {
    assert.equal(isImageCapabilityQuestion(message), true, message);
  }
});

test("keeps image requests with a described subject on the generation path", () => {
  for (const message of [
    "Can you generate an image of a cat?",
    "Could you create a picture showing a mountain?",
    "Can you make an image with a futuristic city?",
  ]) {
    assert.equal(isImageCapabilityQuestion(message), false, message);
  }
});
