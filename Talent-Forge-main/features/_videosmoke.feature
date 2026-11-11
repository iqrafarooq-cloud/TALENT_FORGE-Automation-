@videosmoke
Feature: Video smoke
  Scenario: Video smoke fails on purpose
    Given the video smoke page is open
    Then the video smoke assertion fails
