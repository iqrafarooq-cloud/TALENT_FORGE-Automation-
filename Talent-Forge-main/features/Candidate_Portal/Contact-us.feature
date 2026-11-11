@contact-us
Feature: Candidate Portal - Contact Us support request

  Background:
    Given I am logged in as the Contact Us candidate

  @positive
  Scenario: Verify that the Contact Us form opens from the sidebar and renders its documented contract
    When I open the Contact Us form
    Then the Contact Us form should be displayed
    And the Contact Us form should render its documented contract
    And the issue field should not be selectable until a category is chosen
    And the Contact Us Submit button should be disabled

  @positive
  Scenario: Verify that each category drives its own issue list and switching category clears it
    When I open the Contact Us form
    Then each category should offer exactly these issues:
      | category             | issues                                                                                                   |
      | My Track/Progress    | I can't access a lesson, I completed something but it's not updating, I'm stuck and need guidance, Other |
      | Assessment/Test      | Other, Unable to start, Submission failed, Score seems incorrect                                         |
      | Documents            | Other, Unable to submit or upload, Need clarification, Not approved                                      |
      | Payment/Subscription | Other, Payment failed, Need invoice, Want to cancel                                                      |
      | Technical Issue      | Other, Page not loading, Error message displayed, Progress/Status not updating, Login issue              |
      | Other                |                                                                                                          |
    When I choose the Contact Us category "Technical Issue"
    And I choose the Contact Us issue "Login issue"
    And I describe the problem as "I cannot sign in on Safari."
    And I choose the Contact Us category "Payment/Subscription"
    Then the chosen issue should have been cleared
    And the description should have been kept
    And the Contact Us Submit button should stay disabled

  @positive @negative
  Scenario: Verify that Submit is enabled by a complete form and by nothing less, in both directions
    When I open the Contact Us form
    Then Submit should be gated exactly as follows:
      | category        | issue            | description                    | submit   |
      |                 |                  |                                | disabled |
      | Technical Issue |                  |                                | disabled |
      |                 |                  | The page will not load at all. | disabled |
      | Technical Issue |                  | The page will not load at all. | disabled |
      | Technical Issue | Page not loading |                                | disabled |
      | Technical Issue | Page not loading | <spaces>                       | disabled |
      | Technical Issue | Page not loading | x                              | enabled  |
      | Technical Issue | Page not loading | The page will not load at all. | enabled  |
      | Other           |                  | No category fits my problem.   | enabled  |
    When I choose the Contact Us category "Documents"
    And I choose the Contact Us issue "Need clarification"
    And I describe the problem as "My transcript has been pending for two weeks."
    Then the Contact Us Submit button should be enabled
    When I clear the description
    Then the Contact Us Submit button should stay disabled

  @negative @known-issue
  Scenario: Verify that an empty required field explains itself instead of only disabling Submit
    When I open the Contact Us form
    Then an untouched form should show no inline error
    And the description should report its own error when left empty:
      | left as                        | inline error             |
      | focused and left empty         | Description is required. |
      | typed, cleared and left        | Description is required. |
      | filled with spaces and left    | Description is required. |
      | error shown, then spaces typed | Description is required. |

  @edge-case
  Scenario: Verify that the description counter tracks what is typed and the field caps at 500
    When I open the Contact Us form
    Then the description counter should track each of these lengths:
      | typed | held | counter |
      |     0 |    0 |   0/500 |
      |     1 |    1 |   1/500 |
      |   250 |  250 | 250/500 |
      |   499 |  499 | 499/500 |
      |   500 |  500 | 500/500 |
      |   501 |  500 | 500/500 |
      |   600 |  500 | 500/500 |

  @positive @edge-case
  Scenario: Verify that the screenshot zone accepts PNG and JPG at every size up to exactly 10 MB
    When I open the Contact Us form
    Then each screenshot should be handled as follows:
      | file                   | bytes    | outcome  | message |
      | less than 5MB.png      |  5222400 | accepted |         |
      | screenshot.jpeg        |   262144 | accepted |         |
      | less than 10MBsize.jpg |  8451442 | accepted |         |
      | Exact10MB.png          | 10485760 | accepted |         |
      | Exact10MB.jpg          | 10485760 | accepted |         |

  @negative @edge-case
  Scenario: Verify that the screenshot zone refuses anything over 10 MB or of an unsupported type
    When I open the Contact Us form
    Then each screenshot should be handled as follows:
      | file                 | bytes    | outcome | message                                                                      |
      | OverLimitBy1Byte.png | 10485761 | refused | This file is too large. Maximum size is 10.0 MB.                             |
      |        11Mb size.jpg | 11534336 | refused | This file is too large. Maximum size is 10.0 MB.                             |
      | docx file.docx       |          | refused | This file type is not allowed. Use one of the accepted formats listed below. |

  @edge-case
  Scenario: Verify that an attached screenshot can be removed and the upload area restored
    When I open the Contact Us form
    And I attach the screenshot "less than 5MB.png"
    Then the attached screenshot should be "less than 5MB.png"
    When I remove the attached screenshot
    Then no screenshot should be attached
    And the upload area should still be offered
  # ------------------------------------------------------------------ dismissal and routing

  @edge-case
  Scenario: Verify that every dismissal route closes the form, sends nothing and discards the draft
    Then dismissing the Contact Us form should discard it, by each of these routes:
      | route  |
      | Cancel |
      | X      |
      | Escape |

  @edge-case
  Scenario: Verify that Contact Us is a modal with no route of its own
    When I note the current URL
    And I open the Contact Us form
    Then the URL should not have changed
    And the Contact Us entry point should be a button rather than a link

  @positive @submits-request
  Scenario: Verify that a request submitted without a screenshot succeeds and confirms itself
    When I open the Contact Us form
    Then the Contact Us form should be blank
    When I choose the Contact Us category "Technical Issue"
    And I choose the Contact Us issue "Page not loading"
    And I describe the problem as "The dashboard will not load for me. Automated check - please ignore."
    Then the Contact Us Submit button should be enabled
    When I submit the Contact Us form
    Then the support request should be accepted by the server
    And the submitted request should carry:
      | field    | value          |
      | category | technicalIssue |
      | issue    | pageNotLoading |
      | status   | OPEN           |
    And the submitted request should have carried no screenshot
    And a submission confirmation should be displayed
    And the confirmation should read exactly "Support request submitted successfully."
    And no error should be displayed alongside the confirmation
    And the Contact Us form should close
    When I reopen the Contact Us form
    Then the Contact Us form should be blank

  @positive @submits-request @end-to-end
  Scenario: Verify that a candidate can report a problem end to end and start cleanly afterwards
    When I open the Contact Us form
    Then the Contact Us form should be blank
    When I choose the Contact Us category "Payment/Subscription"
    And I choose the Contact Us issue "Need invoice"
    And I describe the problem as "I need a VAT invoice for my monthly subscription. Automated end-to-end check - please ignore."
    And I attach the screenshot "less than 5MB.png"
    Then the Contact Us Submit button should be enabled
    When I submit the Contact Us form
    Then the support request should be accepted by the server
    And the submitted request should carry:
      | field    | value               |
      | category | paymentSubscription |
      | issue    | needInvoice         |
      | status   | OPEN                |
    And the submitted request should have carried a screenshot
    And a submission confirmation should be displayed
    And the confirmation should read exactly "Support request submitted successfully."
    And no error should be displayed alongside the confirmation
    And the Contact Us form should close
    When I reopen the Contact Us form
    Then the Contact Us form should be blank

  @positive @submits-request @email
  Scenario: Verify that submitting a support request notifies the assigned agent by email
    Given I note the mailbox position before contacting support
    When I open the Contact Us form
    And I choose the Contact Us category "Technical Issue"
    And I choose the Contact Us issue "Error message displayed"
    And I describe the problem as a uniquely marked support request
    And I submit the Contact Us form
    Then the support request should be accepted by the server
    And a submission confirmation should be displayed
    And a support notification email carrying that marker should arrive
    And the notification should be addressed to the assigned agent rather than the candidate
    And the notification should carry the candidate and the request they submitted
